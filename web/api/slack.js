// 슬랙 관리 봇: 채널에서 "@goods-radar 신청 / 의견 / 기타" 로 목록을 부르고, 버튼으로 바로 처리
//   한눈에 보기: "@goods-radar" 또는 "@goods-radar 전체" (메뉴별 요약 + [보기] 버튼)
//   조회만: "@goods-radar 매장 / 수집 / 통계 [오늘|7일|30일|90일]"
//   매장 신청: [승인] [거절 이유 선택 ▾]   (승인하면 PC 크롤러가 15분 안에 팔로우·첫 수집)
//   의견:      [보관] [삭제]   ("의견 보관": 보관한 의견 [삭제], "의견 스팸": 스팸함 [복원] [삭제], 삭제는 완전히 지움)
//   기타 검토: [게시] [삭제]   (삭제는 글·사진을 지우고 다시 수집되지 않게 기록, 되돌릴 수 없음)
//
// 슬랙 앱 설정
//   OAuth & Permissions → Bot Token Scopes: app_mentions:read, chat:write
//   Event Subscriptions → Request URL: https://goods-radar-xi.vercel.app/api/slack, Bot event: app_mention
//   Interactivity & Shortcuts → Request URL: https://goods-radar-xi.vercel.app/api/slack (버튼용)
// Vercel 환경 변수 (서버 전용, 화면 코드에는 들어가지 않음)
//   SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, SUPABASE_URL, SUPABASE_SECRET_KEY
//   SLACK_ALLOWED_USERS  답하고 버튼을 누를 수 있는 슬랙 사용자 ID (쉼표로 여러 명). 비우면 아무도 처리 못 함(조회만)
import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const SITE = 'https://goods-radar-xi.vercel.app'
const MAX_ITEMS = 10 // 한 번에 보여줄 개수 (슬랙 메시지 칸 수 제한)
const env = (k) => process.env[k] ?? ''
const allowedUsers = () => env('SLACK_ALLOWED_USERS').split(',').map((s) => s.trim()).filter(Boolean)

// ---------- 슬랙 요청 확인 ----------
function verified(headers, raw) {
  const ts = headers.get('x-slack-request-timestamp')
  const sig = headers.get('x-slack-signature')
  const secret = env('SLACK_SIGNING_SECRET')
  if (!ts || !sig || !secret) return false
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false // 5분 넘은 요청은 거부 (재전송 공격 방지)
  const mine = 'v0=' + crypto.createHmac('sha256', secret).update(`v0:${ts}:${raw}`).digest('hex')
  return mine.length === sig.length && crypto.timingSafeEqual(Buffer.from(mine), Buffer.from(sig))
}

// ---------- 글자 다듬기 ----------
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const oneLine = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n)}…` : t
}
const fmtTime = (iso) =>
  new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })

function device(ua = '') {
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : ''
  const br = /SamsungBrowser/.test(ua)
    ? '삼성 인터넷'
    : /KAKAOTALK/i.test(ua)
      ? '카톡'
      : /Instagram/.test(ua)
        ? '인스타'
        : /Edg\//.test(ua)
          ? 'Edge'
          : /CriOS|Chrome/.test(ua)
            ? '크롬'
            : /Safari/.test(ua)
              ? '사파리'
              : ''
  return [os, br].filter(Boolean).join(' ')
}

// ---------- 블록 만들기 ----------
const section = (text, accessory) => ({ type: 'section', text: { type: 'mrkdwn', text: text.slice(0, 2900) }, ...(accessory ? { accessory } : {}) })
const context = (text) => ({ type: 'context', elements: [{ type: 'mrkdwn', text }] })
const button = (label, action, value, style, confirm) => ({
  type: 'button',
  text: { type: 'plain_text', text: label },
  action_id: action,
  value: String(value),
  ...(style ? { style } : {}),
  ...(confirm
    ? { confirm: { title: { type: 'plain_text', text: '확인' }, text: { type: 'mrkdwn', text: confirm }, confirm: { type: 'plain_text', text: label }, deny: { type: 'plain_text', text: '취소' }, style: 'danger' } }
    : {}),
})
const actions = (...els) => ({ type: 'actions', elements: els })
// 고르면 바로 처리되는 드롭다운 (값: "id|고른 항목")
const picker = (placeholder, action, id, options) => ({
  type: 'static_select',
  action_id: action,
  placeholder: { type: 'plain_text', text: placeholder },
  options: options.map((o) => ({ text: { type: 'plain_text', text: o }, value: `${id}|${o}` })),
})
// 직접 거절할 때 고르는 이유 (관리자 화면 web/src/admin/Requests.jsx 와 같은 목록)
const REJECT_REASONS = ['굿즈샵 아님', '이미 등록됨', '운영 안 함', '계정 없음·비공개', '기타']
const msg = (text, blocks) => ({ text, blocks })

const HELP = [
  '*굿즈레이더 관리 봇* 사용법',
  '• `@goods-radar` 또는 `@goods-radar 전체`: 모든 메뉴 한눈에 보기 (버튼으로 자세히)',
  '*처리*',
  '• `@goods-radar 신청`: 확인이 필요한 매장 신청 → [승인] [거절 이유 선택]',
  '• `@goods-radar 의견`: 새 의견 → [보관] [삭제]  (`의견 보관`: 보관한 의견 → [삭제] / `의견 스팸`: 자동으로 걸러진 의견 → [복원] [삭제])',
  '• `@goods-radar 기타`: 기타 검토 대기 글 → [게시] [삭제]',
  '*조회*',
  '• `@goods-radar 매장`: 매장 수·매장 목록',
  '• `@goods-radar 수집`: 마지막 자동 확인·수집 중인 매장·오래 수집 안 된 매장·분류별 글 수',
  '• `@goods-radar 통계`: 사용 통계 (기본 7일, `통계 오늘` / `통계 30일` / `통계 90일`)',
  '• `@goods-radar 도움말`: 이 안내',
].join('\n')

const CATEGORIES = ['입고', '콜라보·팝업', '이벤트·안내', '기타']
const STALE_HOURS = 26 // 정기 확인이 24시간마다라 이보다 오래되면 문제 (관리자 화면과 같음)
const DAY = 86400000
const ago = (iso) => {
  if (!iso) return '기록 없음'
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 1) return '방금'
  if (m < 60) return `${m}분 전`
  if (m < 60 * 24) return `${Math.floor(m / 60)}시간 전`
  return `${Math.floor(m / 1440)}일 전`
}
// 자동 확인이 1시간 넘게 없으면 문제 (인스타 확인은 9~24시라 Supabase 감시처럼 10~24시에만 따짐)
const isQuiet = (lastIso) => {
  const h = Number(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul', hour: 'numeric', hour12: false })) % 24
  return h >= 10 && (!lastIso || Date.now() - new Date(lastIso).getTime() > 60 * 60000)
}
const pct = (n, total) => (total ? Math.round((n / total) * 100) : 0)
const bar = (n, max) => '▇'.repeat(max ? Math.max(n ? 1 : 0, Math.round((n / max) * 10)) : 0)
const rank = (rows, n = 5) => (rows.length ? rows.slice(0, n).map(([k, v], i) => `${i + 1}. ${esc(k)}  *${v}*`).join('\n') : '_기록 없음_')
const countBy = (arr, keyFn) => {
  const m = new Map()
  for (const x of arr) {
    const k = keyFn(x)
    if (k == null || k === '') continue
    m.set(k, (m.get(k) ?? 0) + 1)
  }
  return [...m].sort((a, b) => b[1] - a[1])
}
// 본문 첫 줄 (해시태그·이모지 줄 건너뜀)
const titleOf = (caption) =>
  String(caption ?? '')
    .split('\n')
    .map((l) => l.replace(/#[^\s#]+/g, '').trim())
    .find((l) => (l.match(/[가-힣A-Za-z]/g) ?? []).length >= 2) ?? ''

// ---------- 조회: 매장 ----------
async function viewShops(db) {
  const [a, b, p] = await Promise.all([
    db.from('accounts').select('username, display_name, account_type, hidden, last_crawled_at').order('display_name'),
    db.from('branches').select('account_username, name, region'),
    db.from('posts').select('account_username').limit(10000),
  ])
  if (a.error) throw a.error
  const posts = new Map(countBy(p.data ?? [], (x) => x.account_username))
  const shown = a.data.filter((s) => !s.hidden)
  const hidden = a.data.filter((s) => s.hidden)
  const line = (s) => {
    const br = (b.data ?? []).filter((x) => x.account_username === s.username)
    const regions = [...new Set(br.map((x) => x.region).filter(Boolean))].join('·')
    return `• <https://www.instagram.com/${s.username}/|*${esc(s.display_name)}*>  ${esc(regions || '지역 없음')}${br.length > 1 ? ` (지점 ${br.length})` : ''}${s.account_type && s.account_type !== '굿즈샵' ? ` · ${esc(s.account_type)}` : ''}\n      글 ${posts.get(s.username) ?? 0}개 · 마지막 수집 ${ago(s.last_crawled_at)}`
  }
  const blocks = [section(`🏪 *매장 ${shown.length}곳*${hidden.length ? `  (숨김 ${hidden.length}곳 별도)` : ''}`)]
  // 섹션 하나에 3000자 제한이 있어 8곳씩 나눔
  for (let i = 0; i < shown.length; i += 8) blocks.push(section(shown.slice(i, i + 8).map(line).join('\n')))
  if (hidden.length) blocks.push(context(`숨긴 매장: ${hidden.map((s) => esc(s.display_name)).join(', ')}`))
  blocks.push(context(`<${SITE}/admin?tab=shops|관리자 화면에서 매장 관리>`))
  return msg(`매장 ${shown.length}곳`, blocks)
}

// ---------- 조회: 수집 상태 ----------
async function viewStatus(db) {
  const head = (q) => q.then(({ count }) => count ?? 0)
  const posts = () => db.from('posts').select('code', { count: 'exact', head: true })
  const [l, a, total, review, ...byCat] = await Promise.all([
    db.from('crawl_logs').select('created_at, message, level').order('created_at', { ascending: false }).limit(200),
    db.from('accounts').select('display_name, last_crawled_at, hidden'),
    head(posts()),
    head(posts().eq('needs_review', true)),
    ...CATEGORIES.map((c) => head(posts().eq('category', c))),
  ])
  if (l.error) throw l.error
  const logs = l.data
  const lastRun = logs.find((x) => x.message.startsWith('피드 확인'))
  const loginError = logs.find((x) => x.message.includes('로그인이 풀려'))
  const loginBroken = loginError && (!lastRun || new Date(loginError.created_at) > new Date(lastRun.created_at))
  const shops = (a.data ?? []).filter((s) => !s.hidden)
  const stale = shops.filter((s) => !s.last_crawled_at || Date.now() - new Date(s.last_crawled_at).getTime() > STALE_HOURS * 3600000)
  const quiet = isQuiet(lastRun?.created_at)
  const problems = logs.filter((x) => x.level !== 'info' && Date.now() - new Date(x.created_at).getTime() < DAY)

  const blocks = [section('📡 *수집 상태*')]
  if (loginBroken) blocks.push(section(`🚨 *인스타 로그인이 풀렸습니다.* PC에서 \`npm run login\` 으로 다시 로그인하세요. (${fmtTime(loginError.created_at)})`))
  blocks.push({
    type: 'section',
    fields: [
      { type: 'mrkdwn', text: `*마지막 자동 확인*\n${ago(lastRun?.created_at)}${quiet ? ' ⚠️' : ''}\n_15분마다 · 9~24시_` },
      { type: 'mrkdwn', text: `*수집 중인 매장*\n${shops.length}곳` },
      { type: 'mrkdwn', text: `*오래 수집 안 된 매장*\n${stale.length ? `⚠️ ${stale.length}곳: ${stale.map((s) => esc(s.display_name)).join(', ')}` : '없음 ✅'}` },
      { type: 'mrkdwn', text: `*최근 24시간 문제 기록*\n${problems.length ? `⚠️ ${problems.length}건` : '없음 ✅'}` },
    ],
  })
  if (quiet) blocks.push(context('⚠️ 1시간 넘게 자동 확인 기록이 없습니다. PC가 꺼졌거나 작업 스케줄러가 멈췄을 수 있습니다.'))
  const max = Math.max(...byCat)
  blocks.push(
    section(
      `*수집된 글 ${total}개*${review ? `  (기타 검토 대기 ${review})` : ''}\n` +
        CATEGORIES.map((c, i) => `${c}  *${byCat[i]}개* (${pct(byCat[i], total)}%)  ${bar(byCat[i], max)}`).join('\n'),
    ),
  )
  if (problems.length) blocks.push(section(`*최근 문제 기록*\n${problems.slice(0, 5).map((x) => `• ${fmtTime(x.created_at)} ${esc(oneLine(x.message, 120))}`).join('\n')}`))
  blocks.push(context(`<${SITE}/admin?tab=status|관리자 화면에서 수집 기록 보기>`))
  return msg(`수집 상태: 마지막 확인 ${ago(lastRun?.created_at)}`, blocks)
}

// ---------- 조회: 통계 ----------
const FEATURE_LABELS = {
  tab: '분류 탭 바꾸기', sort: '정렬 바꾸기', filter: '필터 사용', search: '검색', more: '글 상세 보기', new_posts: '새 소식 버튼',
  shop_open: '매장 정보 창 열기', shop_only: '이 매장 소식만 보기', map_click: '네이버 지도', phone_click: '전화 걸기',
  insta_click: '인스타그램 이동', request_open: '매장 추가 신청 창', request_submit: '매장 추가 신청 완료',
}
const DEVICE_LABELS = { mobile: '휴대폰', tablet: '태블릿', pc: 'PC' }
const kstDay = (iso) => new Date(new Date(iso).getTime() + 9 * 3600000).toISOString().slice(0, 10)

async function viewStats(db, text) {
  const days = /오늘|1일/.test(text) ? 1 : /90/.test(text) ? 90 : /30|한\s*달/.test(text) ? 30 : 7
  const since = new Date(Date.now() - days * DAY).toISOString()
  const rows = []
  for (let from = 0; from < 50000; from += 1000) {
    const { data, error } = await db
      .from('events')
      .select('created_at, visitor_id, session_id, type, target, meta, device')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .range(from, from + 999)
    if (error) throw error
    rows.push(...data)
    if (data.length < 1000) break
  }
  const { data: accts } = await db.from('accounts').select('username, display_name')
  const names = new Map((accts ?? []).map((x) => [x.username, x.display_name]))
  const visits = rows.filter((r) => r.type === 'visit')
  const byType = (t) => rows.filter((r) => r.type === t)

  // 일별 방문자
  const dayMap = new Map()
  for (let i = Math.min(days, 14) - 1; i >= 0; i--) dayMap.set(kstDay(new Date(Date.now() - i * DAY).toISOString()), new Set())
  for (const r of rows) dayMap.get(kstDay(r.created_at))?.add(r.visitor_id)
  const daily = [...dayMap].map(([d, s]) => [d.slice(5).replace('-', '.'), s.size])
  const dmax = Math.max(1, ...daily.map((d) => d[1]))

  // 매장별 관심도 (정보 창 + 인스타 이동 + 지도 + 전화)
  const score = new Map()
  const add = (u) => u && score.set(u, (score.get(u) ?? 0) + 1)
  for (const r of byType('shop_open')) add(r.target)
  for (const r of byType('insta_click')) add(r.meta?.shop)
  for (const r of byType('map_click')) add(r.target)
  for (const r of byType('phone_click')) add(r.target)
  const shops = [...score].sort((a, b) => b[1] - a[1]).map(([u, n]) => [names.get(u) ?? u, n])

  // 인스타 이동 많은 글 (제목)
  const topPosts = countBy(byType('insta_click'), (r) => r.target).slice(0, 5)
  const { data: pp } = topPosts.length ? await db.from('posts').select('code, caption, account_username').in('code', topPosts.map((x) => x[0])) : { data: [] }
  const pmap = new Map((pp ?? []).map((x) => [x.code, x]))
  const postLines = topPosts.length
    ? topPosts
        .map(([code, n], i) => {
          const p = pmap.get(code)
          const label = p ? `${names.get(p.account_username) ?? ''} · ${oneLine(titleOf(p.caption) || '(본문 없음)', 40)}` : `${code} (삭제된 글)`
          return `${i + 1}. <https://www.instagram.com/p/${code}/|${esc(label)}>  *${n}*`
        })
        .join('\n')
    : '_기록 없음_'

  const label = days === 1 ? '오늘(24시간)' : `최근 ${days}일`
  const blocks = [
    section(`📊 *사용 통계 · ${label}*`),
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*방문자*\n${new Set(rows.map((r) => r.visitor_id)).size.toLocaleString('ko-KR')}명` },
        { type: 'mrkdwn', text: `*방문*\n${new Set(visits.map((r) => r.session_id)).size.toLocaleString('ko-KR')}회` },
        { type: 'mrkdwn', text: `*기록된 행동*\n${rows.length.toLocaleString('ko-KR')}건` },
        { type: 'mrkdwn', text: `*매장 추가 신청*\n${byType('request_submit').length}건` },
      ],
    },
  ]
  if (days > 1) blocks.push(section(`*일별 방문자*${days > 14 ? ' (최근 14일)' : ''}\n${daily.map(([d, n]) => `\`${d}\` ${bar(n, dmax)} ${n}`).join('\n')}`))
  blocks.push(
    { type: 'section', fields: [
      { type: 'mrkdwn', text: `*기기*\n${rank(countBy(visits, (r) => DEVICE_LABELS[r.device] ?? r.device), 3)}` },
      { type: 'mrkdwn', text: `*유입 경로*\n${rank(countBy(visits, (r) => r.meta?.ref ?? '직접 방문·북마크'), 5)}` },
    ] },
    { type: 'section', fields: [
      { type: 'mrkdwn', text: `*매장별 관심도*\n${rank(shops, 5)}` },
      { type: 'mrkdwn', text: `*인기 검색어*\n${rank(countBy(byType('search'), (r) => String(r.target ?? '').toLowerCase()), 5)}` },
    ] },
    section(`*인스타 이동이 많은 글*\n${postLines}`),
    { type: 'section', fields: [
      { type: 'mrkdwn', text: `*많이 본 탭*\n${rank(countBy(byType('tab'), (r) => (r.target === 'map' ? '지도' : r.target)), 5)}` },
      { type: 'mrkdwn', text: `*기능 사용*\n${rank(countBy(rows.filter((r) => r.type !== 'visit'), (r) => FEATURE_LABELS[r.type] ?? r.type), 5)}` },
    ] },
    context(`\`통계 오늘\` · \`통계 7일\` · \`통계 30일\` · \`통계 90일\`  ·  <${SITE}/admin?tab=stats|관리자 화면에서 자세히>`),
  )
  return msg(`사용 통계 ${label}`, blocks)
}

// ---------- 목록 ----------
async function listRequests(db) {
  const { data, error } = await db
    .from('shop_requests')
    .select('id, username, display_name, region, status, note, auto_note, result, created_at, map_url')
    .in('status', ['pending', 'failed'])
    .order('created_at', { ascending: false })
  if (error) throw error
  if (!data.length) return msg('✅ 확인이 필요한 매장 신청이 없습니다.')
  const blocks = [section(`📮 *확인이 필요한 매장 신청 ${data.length}건*`)]
  for (const r of data.slice(0, MAX_ITEMS)) {
    const name = [r.display_name, r.region].filter(Boolean).join(' · ')
    const why = r.status === 'failed' ? `⚠️ 추가 실패: ${r.result ?? ''}` : `🔎 ${r.auto_note ?? '자동 검토 대기 중'}`
    // 신청자가 보낸 지도 링크 (슬랙 링크 문법이 깨지지 않게 | > 는 인코딩)
    const map = r.map_url
      ? `\n🗺 <${r.map_url.replace(/\|/g, '%7C').replace(/>/g, '%3E')}|신청자가 보낸 ${/kakao|kko\.to/i.test(r.map_url) ? '카카오' : '네이버'} 지도>`
      : ''
    blocks.push(
      { type: 'divider' },
      section(
        `<https://www.instagram.com/${r.username}/|*@${r.username}*>${name ? `  ${esc(name)}` : ''}  _${fmtTime(r.created_at)}_\n${esc(oneLine(why, 300))}${map}${r.note ? `\n“${esc(oneLine(r.note, 150))}”` : ''}`,
      ),
      actions(button(r.status === 'failed' ? '다시 시도' : '승인', 'req_approve', r.id, 'primary'), picker('거절 이유 선택', 'req_reject', r.id, REJECT_REASONS)),
    )
  }
  blocks.push(footer(data.length, 'requests', '승인하면 PC 크롤러가 15분 안에 팔로우·첫 수집을 합니다.'))
  return msg(`매장 신청 ${data.length}건`, blocks)
}

// mode: 'new' 새 의견 [보관] [삭제] / 'kept' 보관한 의견 [삭제] / 'spam' 스팸함 [복원] [삭제]
const FB_TITLE = { new: '💬 *새 의견', kept: '📦 *보관한 의견', spam: '🗑 *스팸함' }
const FB_EMPTY = { new: '✅ 새 의견이 없습니다.', kept: '📦 보관한 의견이 없습니다.', spam: '🗑 스팸함이 비어 있습니다.' }
async function listFeedback(db, mode = 'new') {
  const { data, error } = await db
    .from('feedback')
    .select('id, kind, tag, message, context, ua, status, filter_note, created_at')
    .eq('status', mode)
    .order('created_at', { ascending: false })
    .limit(30)
  if (error) throw error
  if (!data.length) return msg(FB_EMPTY[mode])
  const blocks = [section(`${FB_TITLE[mode]} ${data.length}건*`)]
  if (mode === 'spam') blocks.push(context('자동으로 걸러진 의견입니다. 잘못 걸러졌으면 [복원], 30일 지나면 자동 삭제됩니다.'))
  for (const f of data.slice(0, MAX_ITEMS)) {
    const meta = [fmtTime(f.created_at), f.context, device(f.ua ?? '')].filter(Boolean).join(' · ')
    const btns = mode === 'new' ? [button('보관', 'fb_keep', f.id, 'primary')] : mode === 'spam' ? [button('복원', 'fb_restore', f.id, 'primary')] : []
    // 삭제 뒤 같은 목록을 다시 보여주도록 어느 목록인지 함께 보냄
    btns.push(button('삭제', 'fb_delete', `${f.id}${mode === 'new' ? '' : `:${mode}`}`, 'danger', '이 의견을 삭제할까요? 되돌릴 수 없습니다.'))
    const why = f.filter_note && mode === 'spam' ? `\n🤖 ${esc(oneLine(f.filter_note, 150))}` : ''
    blocks.push(
      { type: 'divider' },
      section(`*[${esc(f.kind)}]*${f.tag ? ` #${esc(f.tag)}` : ''}\n${esc(oneLine(f.message, 500))}${why}\n_${esc(meta)}_`),
      actions(...btns),
    )
  }
  blocks.push(footer(data.length, 'feedback'))
  return msg(`의견 ${data.length}건`, blocks)
}

async function listReview(db) {
  const [p, a] = await Promise.all([
    db.from('posts').select('code, account_username, caption, url, image_path, media_type, posted_at').eq('needs_review', true).order('posted_at', { ascending: false }),
    db.from('accounts').select('username, display_name'),
  ])
  if (p.error) throw p.error
  if (!p.data.length) return msg('✅ 검토할 기타 글이 없습니다.')
  const names = new Map((a.data ?? []).map((x) => [x.username, x.display_name]))
  const blocks = [section(`📝 *기타 검토 대기 ${p.data.length}개*\n검토 중에도 사이트 "전체" 탭에는 보입니다.`)]
  for (const post of p.data.slice(0, MAX_ITEMS)) {
    const img = post.image_path
      ? { type: 'image', image_url: `${env('SUPABASE_URL')}/storage/v1/object/public/post-images/${post.image_path.replace(/\.webp$/, ".t.webp")}`, alt_text: '게시물 사진' }
      : null
    blocks.push(
      { type: 'divider' },
      section(
        `*${esc(names.get(post.account_username) ?? post.account_username)}*  _${fmtTime(post.posted_at)}_${post.media_type === '동영상' ? '  ▶ 릴스' : ''}\n${esc(oneLine(post.caption || '(본문 없음)', 300))}\n<${post.url}|인스타에서 보기>`,
        img,
      ),
      actions(
        button('기타로 게시', 'post_publish', post.code, 'primary'),
        button('삭제', 'post_delete', post.code, 'danger', '이 글을 완전히 삭제할까요?\n글과 사진이 지워지고 다시 수집되지 않습니다. 되돌릴 수 없습니다.'),
      ),
    )
  }
  blocks.push(footer(p.data.length, 'review', '분류를 바꿔서 게시하려면 관리자 화면에서 하세요.'))
  return msg(`기타 검토 ${p.data.length}개`, blocks)
}

// ---------- 한눈에 보기: 메뉴별 요약 + [보기] 버튼 (누르면 같은 스레드에 자세한 목록) ----------
const OPEN = {
  open_requests: (db) => listRequests(db),
  open_feedback: (db) => listFeedback(db, 'new'),
  open_feedback_kept: (db) => listFeedback(db, 'kept'),
  open_feedback_spam: (db) => listFeedback(db, 'spam'),
  open_review: (db) => listReview(db),
  open_shops: (db) => viewShops(db),
  open_status: (db) => viewStatus(db),
  open_stats: (db) => viewStats(db, '7일'),
}

async function viewOverview(db) {
  const head = (q) => q.then(({ count }) => count ?? 0)
  const since7 = new Date(Date.now() - 7 * DAY).toISOString()
  const events = async () => {
    const rows = []
    for (let from = 0; from < 50000; from += 1000) {
      const { data, error } = await db.from('events').select('created_at, visitor_id').gte('created_at', since7).range(from, from + 999)
      if (error) throw error
      rows.push(...data)
      if (data.length < 1000) break
    }
    return rows
  }
  const [req, fbNew, fbKept, fbSpam, review, a, l, ev] = await Promise.all([
    head(db.from('shop_requests').select('id', { count: 'exact', head: true }).in('status', ['pending', 'failed'])),
    head(db.from('feedback').select('id', { count: 'exact', head: true }).eq('status', 'new')),
    head(db.from('feedback').select('id', { count: 'exact', head: true }).eq('status', 'kept')),
    head(db.from('feedback').select('id', { count: 'exact', head: true }).eq('status', 'spam')),
    head(db.from('posts').select('code', { count: 'exact', head: true }).eq('needs_review', true)),
    db.from('accounts').select('hidden, last_crawled_at'),
    db.from('crawl_logs').select('created_at, message, level').order('created_at', { ascending: false }).limit(200),
    events(),
  ])
  if (a.error) throw a.error
  if (l.error) throw l.error

  // 수집 상태 (viewStatus 와 같은 기준)
  const logs = l.data
  const lastRun = logs.find((x) => x.message.startsWith('피드 확인'))
  const loginError = logs.find((x) => x.message.includes('로그인이 풀려'))
  const loginBroken = loginError && (!lastRun || new Date(loginError.created_at) > new Date(lastRun.created_at))
  const quiet = isQuiet(lastRun?.created_at)
  const problems = logs.filter((x) => x.level !== 'info' && Date.now() - new Date(x.created_at).getTime() < DAY).length
  const shown = a.data.filter((s) => !s.hidden)
  const stale = shown.filter((s) => !s.last_crawled_at || Date.now() - new Date(s.last_crawled_at).getTime() > STALE_HOURS * 3600000).length

  // 방문자: 오늘(한국 날짜) · 최근 7일
  const today = kstDay(new Date().toISOString())
  const visitors7 = new Set(ev.map((r) => r.visitor_id)).size
  const visitorsToday = new Set(ev.filter((r) => kstDay(r.created_at) === today).map((r) => r.visitor_id)).size

  const warn = (on) => (on ? '⚠️ ' : '')
  const status = loginBroken
    ? '🚨 인스타 로그인 풀림'
    : `마지막 피드 확인 ${ago(lastRun?.created_at)} · 문제 ${problems}건${stale ? ` · 오래 수집 안 된 매장 ${stale}곳` : ''}`
  const rows = [
    [`📥 ${warn(req)}매장 신청 대기 *${req}건*`, button('신청 보기', 'open_requests', 'x')],
    [
      `💬 ${warn(fbNew)}새 의견 *${fbNew}건* · 보관 ${fbKept}건${fbSpam ? ` · 스팸함 ${fbSpam}건` : ''}`,
      button('의견 보기', fbNew || (!fbKept && !fbSpam) ? 'open_feedback' : fbKept ? 'open_feedback_kept' : 'open_feedback_spam', 'x'),
    ],
    [`📝 ${warn(review)}검토할 기타 글 *${review}개*`, button('기타 보기', 'open_review', 'x')],
    [`🏪 매장 *${shown.length}곳*${a.data.length > shown.length ? ` (숨김 ${a.data.length - shown.length})` : ''}`, button('매장 보기', 'open_shops', 'x')],
    [`🔄 ${warn(loginBroken || quiet || problems || stale)}${status}`, button('수집 보기', 'open_status', 'x')],
    [`📊 오늘 방문자 *${visitorsToday}명* · 7일 ${visitors7}명`, button('통계 보기', 'open_stats', 'x')],
  ]
  const blocks = [section('*[굿즈레이더] 한눈에 보기*'), ...rows.map(([t, b]) => section(t, b))]
  if (quiet && !loginBroken) blocks.push(context('⚠️ 1시간 넘게 자동 확인 기록이 없습니다. PC가 꺼졌거나 작업 스케줄러가 멈췄을 수 있습니다.'))
  blocks.push(context(`버튼을 누르면 이 스레드에 자세한 목록이 나옵니다 · \`@goods-radar 도움말\` · <${SITE}/admin|관리자 화면>`))
  return msg(`한눈에 보기: 신청 ${req} · 새 의견 ${fbNew} · 기타 검토 ${review}`, blocks)
}

function footer(total, tab, note = '') {
  const more = total > MAX_ITEMS ? `${MAX_ITEMS}개만 보여줍니다 (전체 ${total}개). ` : ''
  return context(`${more}${note} <${SITE}/admin?tab=${tab}|관리자 화면에서 보기>`.trim())
}

// 멘션 글자 → 답장
export async function answer(text, db) {
  const t = text.replace(/<@[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  try {
    if (!t || /^(전체|한눈|요약|메뉴)/.test(t)) return await viewOverview(db)
    if (/^(신청|매장\s*신청)/.test(t)) return await listRequests(db)
    if (/^(의견|스팸)/.test(t)) return await listFeedback(db, /스팸/.test(t) ? 'spam' : /보관/.test(t) ? 'kept' : 'new')
    if (/^(기타|검토)/.test(t)) return await listReview(db)
    if (/^매장/.test(t)) return await viewShops(db)
    if (/^(수집|상태)/.test(t)) return await viewStatus(db)
    if (/^통계/.test(t)) return await viewStats(db, t)
  } catch (err) {
    return msg(`⚠️ 읽지 못했습니다: ${esc(err.message)}`)
  }
  return msg(HELP)
}

// ---------- 버튼 처리 ----------
// 반환: { done: 결과 문구, list: 다시 보여줄 목록 종류 }
export async function act(action, value, db) {
  const now = new Date().toISOString()
  const must = (r) => {
    if (r.error) throw new Error(r.error.message)
    return r
  }
  switch (action) {
    case 'req_approve': {
      const { data } = must(await db.from('shop_requests').select('username, status, account_type').eq('id', value).maybeSingle())
      if (!data || !['pending', 'failed'].includes(data.status)) return { done: '이미 처리된 신청입니다.', list: 'requests' }
      must(await db.from('shop_requests').update({ status: 'approved', result: null, reviewed_at: now, account_type: data.account_type ?? '굿즈샵' }).eq('id', value))
      return { done: `✅ @${data.username} 승인했습니다. PC 크롤러가 15분 안에 추가합니다.`, list: 'requests' }
    }
    case 'req_reject': {
      // 값: "id|이유" (예전 메시지의 [거절] 버튼은 id 만 옴)
      const [id, reason] = String(value).split('|')
      const { data } = must(await db.from('shop_requests').select('username, status').eq('id', id).maybeSingle())
      if (!data || !['pending', 'failed'].includes(data.status)) return { done: '이미 처리된 신청입니다.', list: 'requests' }
      const why = REJECT_REASONS.includes(reason) ? reason : '이유 없음'
      must(await db.from('shop_requests').update({ status: 'rejected', result: `거절: ${why} (슬랙)`, reviewed_at: now }).eq('id', id))
      return { done: `🚫 @${data.username} 신청을 거절했습니다. (${why})`, list: 'requests' }
    }
    case 'fb_keep':
    case 'fb_done': // 예전 메시지의 [확인함] 버튼도 보관으로 처리
      must(await db.from('feedback').update({ status: 'kept', checked_at: now }).eq('id', value).eq('status', 'new'))
      return { done: '📦 보관했습니다. (`@goods-radar 의견 보관`으로 보기)', list: 'feedback' }
    case 'fb_restore':
      must(await db.from('feedback').update({ status: 'new' }).eq('id', value).eq('status', 'spam'))
      return { done: '↩️ 새 의견으로 복원했습니다.', list: 'feedback_spam' }
    case 'fb_delete': {
      const [id, from] = String(value).split(':')
      must(await db.from('feedback').delete().eq('id', id))
      return { done: '🗑 의견을 삭제했습니다.', list: from === 'kept' ? 'feedback_kept' : from === 'spam' ? 'feedback_spam' : 'feedback' }
    }
    case 'post_publish':
      must(await db.from('posts').update({ category: '기타', goods_type: [], hidden: false, needs_review: false, manual: true }).eq('code', value))
      return { done: '✅ 기타로 게시했습니다.', list: 'review' }
    case 'post_delete': {
      const { data: post } = must(await db.from('posts').select('code, account_username, image_path').eq('code', value).maybeSingle())
      if (!post) return { done: '이미 삭제된 글입니다.', list: 'review' }
      // 관리자 화면과 같은 순서: 다시 수집되지 않게 기록 → 사진 → 글
      must(await db.from('deleted_posts').upsert({ code: post.code, account_username: post.account_username }, { onConflict: 'code', ignoreDuplicates: true }))
      if (post.image_path) await db.storage.from('post-images').remove([post.image_path, post.image_path.replace(/\.webp$/, '.t.webp')])
      must(await db.from('posts').delete().eq('code', post.code))
      return { done: '🗑 글을 삭제했습니다.', list: 'review' }
    }
    default:
      return { done: '알 수 없는 버튼입니다.', list: null }
  }
}

const relist = (list, db) =>
  list === 'requests'
    ? listRequests(db)
    : list?.startsWith('feedback')
      ? listFeedback(db, { feedback_kept: 'kept', feedback_spam: 'spam' }[list] ?? 'new')
      : list === 'review' ? listReview(db) : Promise.resolve(msg(''))

// ---------- 슬랙으로 보내기 ----------
async function slackApi(method, payload) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${env('SLACK_BOT_TOKEN')}` },
    body: JSON.stringify(payload),
  })
  const j = await res.json().catch(() => ({}))
  if (!j.ok) console.error(`슬랙 ${method} 실패:`, j.error, JSON.stringify(j.response_metadata ?? {}))
  return j
}
const db = () => createClient(env('SUPABASE_URL'), env('SUPABASE_SECRET_KEY'), { auth: { persistSession: false } })

// ---------- 입구 ----------
export async function POST(request) {
  const raw = await request.text()
  if (!verified(request.headers, raw)) return new Response('invalid signature', { status: 401 })
  // 슬랙이 3초 안에 답을 못 받아 다시 보낸 요청은 무시 (답장이 두 번 가지 않게)
  if (request.headers.get('x-slack-retry-num')) return new Response('ok')

  // 버튼 누름 (form 형식: payload=JSON)
  if ((request.headers.get('content-type') ?? '').includes('application/x-www-form-urlencoded')) {
    const p = JSON.parse(new URLSearchParams(raw).get('payload') ?? '{}')
    if (p.type !== 'block_actions' || !p.actions?.[0]) return new Response('ok')
    const a = p.actions[0]
    if (!allowedUsers().includes(p.user?.id)) {
      await fetch(p.response_url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ response_type: 'ephemeral', replace_original: false, text: '처리 권한이 없습니다.' }) })
      return new Response('ok')
    }
    const client = db()
    // 한눈에 보기의 [보기] 버튼: 요약은 그대로 두고 같은 스레드에 자세한 목록을 새로 보냄
    if (OPEN[a.action_id]) {
      let m
      try {
        m = await OPEN[a.action_id](client)
      } catch (err) {
        m = msg(`⚠️ 읽지 못했습니다: ${esc(err.message)}`)
      }
      const thread = p.message?.thread_ts ?? p.message?.ts
      await slackApi('chat.postMessage', { channel: p.channel?.id, thread_ts: thread, unfurl_links: false, unfurl_media: false, ...m })
      return new Response('ok')
    }
    let out
    try {
      const r = await act(a.action_id, a.value ?? a.selected_option?.value, client) // 버튼은 value, 드롭다운은 selected_option
      const m = await relist(r.list, client)
      out = { text: `${r.done}\n${m.text}`, blocks: [context(`${esc(r.done)}  · <@${p.user.id}>`), ...(m.blocks ?? [section(m.text)])] }
    } catch (err) {
      out = { text: `⚠️ 처리하지 못했습니다: ${err.message}`, blocks: [context(`⚠️ 처리하지 못했습니다: ${esc(err.message)}`), ...(p.message?.blocks ?? [])] }
    }
    // 원래 목록 메시지를 처리 결과 + 새 목록으로 바꿈
    await fetch(p.response_url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ replace_original: true, ...out }) })
    return new Response('ok')
  }

  const body = JSON.parse(raw)
  if (body.type === 'url_verification') return Response.json({ challenge: body.challenge })

  const ev = body.event
  if (body.type === 'event_callback' && ev?.type === 'app_mention' && !ev.bot_id) {
    const thread = ev.thread_ts ?? ev.ts
    if (!allowedUsers().includes(ev.user)) {
      await slackApi('chat.postMessage', { channel: ev.channel, thread_ts: thread, text: '이 봇은 관리자만 사용할 수 있습니다.' })
    } else {
      const m = await answer(ev.text ?? '', db())
      await slackApi('chat.postMessage', { channel: ev.channel, thread_ts: thread, unfurl_links: false, unfurl_media: false, ...m })
    }
  }
  return new Response('ok')
}

export function GET() {
  return new Response('굿즈레이더 슬랙 봇입니다. 슬랙에서 @goods-radar 도움말 을 입력해 보세요.')
}
