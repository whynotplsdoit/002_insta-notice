// 의견 받기 + 자동 필터링 (Vercel 함수: POST /api/feedback)
//   1) 규칙 검사 (무료, 즉시): 자음·모음만, 같은 글자 반복, 테스트 글자 → 스팸함
//   2) AI 판정 (Claude Haiku 5.5): 욕설·비방만 있는 글, 광고·도배 → 스팸함 / 나머지는 태그 붙여 새 의견
//   AI 가 실패하거나 늦으면 새 의견으로 저장 (의견이 사라지지 않게)
//   스팸은 지우지 않고 status='spam' 으로 숨김 → 관리자 화면 "스팸함"에서 복원·삭제, 30일 뒤 크롤러가 자동 삭제
//
// Vercel 환경 변수 (서버 전용): SUPABASE_URL, SUPABASE_SECRET_KEY, ANTHROPIC_API_KEY
// DB: supabase/17-feedback-filter.sql (웹 화면이 직접 넣는 길은 막혀 있음)
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'

const KINDS = ['의견', '오류', '정보 수정']
export const TAGS = ['매장제보', '버그신고', '기능건의', '정보수정', '기타']
const PER_SENDER_PER_MIN = 3 // 같은 브라우저에서 1분에 3건까지
const BURST_LIMIT = 30 // 10분에 30건 넘게 몰리면 AI 를 부르지 않음 (비용 보호)
const env = (k) => process.env[k] ?? ''

// ---------- 1) 규칙 검사 ----------
// 반환: 스팸 이유 (문자열) 또는 null (통과)
export function ruleCheck(message) {
  const t = String(message ?? '').trim()
  const core = t.replace(/[\s\p{P}\p{S}]/gu, '') // 공백·문장부호·기호·이모지 뺀 글자
  if (core.length < 2) return '내용이 거의 없음'
  if (/^[ㄱ-ㅎㅏ-ㅣ]+$/.test(core)) return '자음·모음만 있음'
  if (new Set(core.toLowerCase()).size === 1) return '같은 글자 반복'
  if (/^(test|테스트|테스팅|asdf|qwer|zxcv|1234|12345|ㅁㄴㅇㄹ|ㅇㅇ|ㅎㅇ)+$/i.test(core)) return '테스트성 글자'
  return null
}

// ---------- 2) AI 판정 ----------
const SYSTEM = `너는 "굿즈레이더" 서비스의 의견함 검수자야. 굿즈레이더는 오타쿠 굿즈샵(애니·게임 굿즈, 쿠지, 가챠, 피규어 매장)의 인스타그램 입고·행사 소식을 모아 보여주는 웹사이트야.
사용자가 보낸 의견 하나를 보고 JSON 으로만 답해.

spam=true 로 판정하는 경우 (관리자에게 보여줄 필요 없음):
- 의미 없는 글: 자음·모음 남발, 키보드 연타, 테스트 글, 맥락 없는 단어 나열
- 악성: 내용 없이 욕설·비속어·비방·인신공격만 있는 글
- 광고·스팸: 서비스와 무관한 홍보, 외부 링크 홍보, 도배

spam=false 로 판정하는 경우:
- 조금이라도 쓸모 있는 내용(오류 신고, 매장 제보, 정보 수정, 기능 제안, 칭찬, 불만)이 있으면 욕설이 섞여 있어도 spam=false
- 애매하면 spam=false (정상 의견을 지우는 것이 스팸을 놓치는 것보다 나쁨)
- 굿즈샵 인스타 주소나 매장 이름을 알려주는 것은 광고가 아니라 매장제보

tag (spam=false 일 때 의미 있음):
- 매장제보: 새 매장·인스타 계정을 추가해 달라는 제보
- 버그신고: 화면 오류, 버튼 안 됨, 느림 등
- 기능건의: 새 기능·개선 요청
- 정보수정: 매장 정보·분류·일정·영업시간·위치가 틀렸다는 내용
- 기타: 그 밖의 모든 것 (칭찬, 일반 의견 등)

reason: 왜 그렇게 판정했는지 한국어로 짧게 (40자 이내).`

const SCHEMA = {
  type: 'object',
  properties: {
    spam: { type: 'boolean' },
    tag: { type: 'string', enum: TAGS },
    reason: { type: 'string' },
  },
  required: ['spam', 'tag', 'reason'],
  additionalProperties: false,
}

// 반환: { spam, tag, reason } 또는 null (AI 를 못 씀 → 새 의견으로 저장)
export async function aiCheck(kind, message) {
  if (!env('ANTHROPIC_API_KEY')) return null
  const client = new Anthropic({ timeout: 8000, maxRetries: 1 })
  try {
    const res = await client.messages.create({
      model: 'claude-haiku-5-5',
      max_tokens: 1024,
      system: SYSTEM,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: `사용자가 고른 종류: ${kind}\n의견:\n"""\n${message}\n"""` }],
    })
    if (res.stop_reason === 'refusal') return null
    const text = res.content.find((b) => b.type === 'text')?.text
    const out = text ? JSON.parse(text) : null
    if (!out || typeof out.spam !== 'boolean' || !TAGS.includes(out.tag)) return null
    return { spam: out.spam, tag: out.tag, reason: String(out.reason ?? '').slice(0, 200) }
  } catch (err) {
    console.error('AI 판정 실패:', err?.status ?? '', err?.message ?? err)
    return null
  }
}

// 종류만 보고 붙이는 기본 태그 (AI 를 못 쓸 때)
const kindTag = (kind) => ({ 오류: '버그신고', '정보 수정': '정보수정' })[kind] ?? null

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } })

export async function POST(request) {
  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'bad_request' }, 400)
  }
  const kind = KINDS.includes(body?.kind) ? body.kind : '의견'
  const message = String(body?.message ?? '').trim()
  const context = body?.context ? String(body.context).slice(0, 200) : null
  const ua = String(request.headers.get('user-agent') ?? '').slice(0, 300) || null
  const sender = /^[a-z0-9]{8,64}$/i.test(body?.sender ?? '') ? body.sender : null
  if (message.length < 2 || message.length > 1000) return json({ error: 'length' }, 400)

  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SECRET_KEY'), { auth: { persistSession: false } })
  const ago = (ms) => new Date(Date.now() - ms).toISOString()

  // 연속 전송 막기
  if (sender) {
    const { count } = await db.from('feedback').select('id', { count: 'exact', head: true }).eq('sender', sender).gte('created_at', ago(60_000))
    if ((count ?? 0) >= PER_SENDER_PER_MIN) return json({ error: 'too_many' }, 429)
  }

  let verdict
  const rule = ruleCheck(message)
  if (rule) {
    verdict = { status: 'spam', tag: null, filter_note: `규칙: ${rule}` }
  } else {
    const { count: recent } = await db.from('feedback').select('id', { count: 'exact', head: true }).gte('created_at', ago(600_000))
    const ai = (recent ?? 0) >= BURST_LIMIT ? null : await aiCheck(kind, message)
    verdict = ai
      ? { status: ai.spam ? 'spam' : 'new', tag: ai.spam ? null : ai.tag, filter_note: `AI: ${ai.reason}` }
      : { status: 'new', tag: kindTag(kind), filter_note: (recent ?? 0) >= BURST_LIMIT ? '의견이 몰려 AI 확인 건너뜀' : 'AI 확인 못 함' }
  }

  const { error } = await db.from('feedback').insert({ kind, message, context, ua, sender, ...verdict })
  if (error) {
    console.error('의견 저장 실패:', error.message)
    return json({ error: 'save_failed' }, 500)
  }
  // 스팸이어도 보낸 사람에게는 똑같이 "보냈어요" (걸러진 걸 알려 주지 않음)
  return json({ ok: true })
}
