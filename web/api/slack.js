// 슬랙 관리 봇: 채널에서 "@goods-radar 신청 / 의견 / 기타" 로 목록을 부르고, 버튼으로 바로 처리
//   매장 신청: [승인] [거절]   (승인하면 PC 크롤러가 15분 안에 팔로우·첫 수집)
//   의견:      [확인함] [삭제]
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
const msg = (text, blocks) => ({ text, blocks })

const HELP = [
  '*굿즈레이더 관리 봇* 사용법',
  '• `@goods-radar 신청`: 확인이 필요한 매장 신청 → [승인] [거절]',
  '• `@goods-radar 의견`: 확인 안 한 새 의견 → [확인함] [삭제]  (`의견 전체`: 최근 의견)',
  '• `@goods-radar 기타`: 기타 검토 대기 글 → [게시] [삭제]',
  '• `@goods-radar 도움말`: 이 안내',
].join('\n')

// ---------- 목록 ----------
async function listRequests(db) {
  const { data, error } = await db
    .from('shop_requests')
    .select('id, username, display_name, region, status, note, auto_note, result, created_at')
    .in('status', ['pending', 'failed'])
    .order('created_at', { ascending: false })
  if (error) throw error
  if (!data.length) return msg('✅ 확인이 필요한 매장 신청이 없습니다.')
  const blocks = [section(`📮 *확인이 필요한 매장 신청 ${data.length}건*`)]
  for (const r of data.slice(0, MAX_ITEMS)) {
    const name = [r.display_name, r.region].filter(Boolean).join(' · ')
    const why = r.status === 'failed' ? `⚠️ 추가 실패: ${r.result ?? ''}` : `🔎 ${r.auto_note ?? '자동 검토 대기 중'}`
    blocks.push(
      { type: 'divider' },
      section(
        `<https://www.instagram.com/${r.username}/|*@${r.username}*>${name ? `  ${esc(name)}` : ''}  _${fmtTime(r.created_at)}_\n${esc(oneLine(why, 300))}${r.note ? `\n“${esc(oneLine(r.note, 150))}”` : ''}`,
      ),
      actions(button(r.status === 'failed' ? '다시 시도' : '승인', 'req_approve', r.id, 'primary'), button('거절', 'req_reject', r.id, 'danger')),
    )
  }
  blocks.push(footer(data.length, 'requests', '승인하면 PC 크롤러가 15분 안에 팔로우·첫 수집을 합니다.'))
  return msg(`매장 신청 ${data.length}건`, blocks)
}

async function listFeedback(db, all) {
  let q = db.from('feedback').select('id, kind, message, context, ua, status, created_at').order('created_at', { ascending: false }).limit(30)
  if (!all) q = q.eq('status', 'new')
  const { data, error } = await q
  if (error) throw error
  if (!data.length) return msg(all ? '받은 의견이 없습니다.' : '✅ 확인 안 한 새 의견이 없습니다.')
  const blocks = [section(`💬 *${all ? '최근 의견' : '새 의견'} ${data.length}건*`)]
  for (const f of data.slice(0, MAX_ITEMS)) {
    const meta = [fmtTime(f.created_at), f.context, device(f.ua ?? '')].filter(Boolean).join(' · ')
    const btns = f.status === 'new' ? [button('확인함', 'fb_done', f.id, 'primary')] : []
    btns.push(button('삭제', 'fb_delete', f.id, 'danger', '이 의견을 삭제할까요? 되돌릴 수 없습니다.'))
    blocks.push(
      { type: 'divider' },
      section(`*[${esc(f.kind)}]*${f.status === 'done' ? '  ✔︎ 확인함' : ''}\n${esc(oneLine(f.message, 500))}\n_${esc(meta)}_`),
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
      ? { type: 'image', image_url: `${env('SUPABASE_URL')}/storage/v1/object/public/post-images/${post.image_path}`, alt_text: '게시물 사진' }
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

function footer(total, tab, note = '') {
  const more = total > MAX_ITEMS ? `${MAX_ITEMS}개만 보여줍니다 (전체 ${total}개). ` : ''
  return context(`${more}${note} <${SITE}/admin?tab=${tab}|관리자 화면에서 보기>`.trim())
}

// 멘션 글자 → 답장
export async function answer(text, db) {
  const t = text.replace(/<@[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  try {
    if (/^(신청|매장)/.test(t)) return await listRequests(db)
    if (/^의견/.test(t)) return await listFeedback(db, /전체|모두/.test(t))
    if (/^(기타|검토)/.test(t)) return await listReview(db)
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
      const { data } = must(await db.from('shop_requests').select('username, status').eq('id', value).maybeSingle())
      if (!data || !['pending', 'failed'].includes(data.status)) return { done: '이미 처리된 신청입니다.', list: 'requests' }
      must(await db.from('shop_requests').update({ status: 'rejected', result: '거절 (슬랙)', reviewed_at: now }).eq('id', value))
      return { done: `🚫 @${data.username} 신청을 거절했습니다.`, list: 'requests' }
    }
    case 'fb_done':
      must(await db.from('feedback').update({ status: 'done', checked_at: now }).eq('id', value))
      return { done: '✔︎ 의견을 확인함으로 옮겼습니다.', list: 'feedback' }
    case 'fb_delete':
      must(await db.from('feedback').delete().eq('id', value))
      return { done: '🗑 의견을 삭제했습니다.', list: 'feedback' }
    case 'post_publish':
      must(await db.from('posts').update({ category: '기타', goods_type: [], hidden: false, needs_review: false, manual: true }).eq('code', value))
      return { done: '✅ 기타로 게시했습니다.', list: 'review' }
    case 'post_delete': {
      const { data: post } = must(await db.from('posts').select('code, account_username, image_path').eq('code', value).maybeSingle())
      if (!post) return { done: '이미 삭제된 글입니다.', list: 'review' }
      // 관리자 화면과 같은 순서: 다시 수집되지 않게 기록 → 사진 → 글
      must(await db.from('deleted_posts').upsert({ code: post.code, account_username: post.account_username }, { onConflict: 'code', ignoreDuplicates: true }))
      if (post.image_path) await db.storage.from('post-images').remove([post.image_path])
      must(await db.from('posts').delete().eq('code', post.code))
      return { done: '🗑 글을 삭제했습니다.', list: 'review' }
    }
    default:
      return { done: '알 수 없는 버튼입니다.', list: null }
  }
}

const relist = (list, db) =>
  list === 'requests' ? listRequests(db) : list === 'feedback' ? listFeedback(db, false) : list === 'review' ? listReview(db) : Promise.resolve(msg(''))

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
    let out
    try {
      const r = await act(a.action_id, a.value, client)
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
