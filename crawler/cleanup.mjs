// 오래된 글 자동 삭제 (DB와 사진 저장소에서 완전히 지움)
// 본문이 비어 있는 글은 처음부터 수집하지 않습니다 (store.mjs).
//
// 규칙 (모든 분류 공통, 날짜는 한국 시각 하루 단위)
//   1) 모든 글은 최대 3달: 기준일(시작일, 없으면 인스타에 올린 날)로부터 3달이 지나면 삭제
//   2) 종료일이 있는 글은 종료일로부터 7일이 지나면 삭제 (3달보다 빠르면 이쪽)
//   → 둘 중 먼저 오는 날에 삭제. 영원히 남는 글은 없음.
//
// 지운 글의 코드는 deleted_posts 에 남겨, 다음 수집 때 다시 들어오지 않게 합니다.
// 기록 정리: 수집 기록(crawl_logs) 30일, 삭제 기록(deleted_posts) 1년, 사용 행동 기록(events) 180일,
//           추가 완료·거절된 매장 신청(shop_requests)·스팸함 의견(feedback status=spam) 30일 지나면 지움.
import { db } from './db.mjs'

export const MAX_KEEP_MONTHS = 3 // 모든 글 최대 게시 기간
export const EVENT_KEEP_DAYS = 7 // 종료일 이후 보관 기간
export const LOG_KEEP_DAYS = 30 // 수집 기록
export const DELETED_RECORD_KEEP_DAYS = 365 // 삭제 기록
export const EVENT_LOG_KEEP_DAYS = 180 // 사용 행동 기록 (통계)
export const REQUEST_KEEP_DAYS = 30 // 추가 완료·거절된 매장 신청 (거절 이유 포함)
export const SPAM_KEEP_DAYS = 30 // 자동으로 걸러진 스팸 의견 (스팸함)

const DAY = 86400000
const KST = 9 * 3600000

// 한국 시각 그날 23:59:59
const endOfKstDay = (ms) => Math.floor((ms + KST) / DAY) * DAY - KST + DAY - 1
// 한국 날짜 기준으로 n달 뒤 (1월 31일 + 1달 = 2월 말일)
function addMonths(ms, n) {
  const d = new Date(ms + KST)
  const day = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + n)
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(day, last))
  return d.getTime() - KST
}
const t = (iso) => new Date(iso).getTime()

// 이 글을 지울 시각 (모든 글에 있음)
export function expiresAt(post) {
  const maxAt = endOfKstDay(addMonths(t(post.starts_at ?? post.posted_at), MAX_KEEP_MONTHS))
  if (!post.ends_at) return maxAt
  return Math.min(maxAt, endOfKstDay(t(post.ends_at)) + EVENT_KEEP_DAYS * DAY)
}

// 오래된 기록 정리. 반환: { logs, records } 지운 개수
export async function cleanupRecords(now = Date.now()) {
  const logBefore = new Date(now - LOG_KEEP_DAYS * DAY).toISOString()
  const recBefore = new Date(now - DELETED_RECORD_KEEP_DAYS * DAY).toISOString()
  const l = await db.from('crawl_logs').delete({ count: 'exact' }).lt('created_at', logBefore)
  const r = await db.from('deleted_posts').delete({ count: 'exact' }).lt('deleted_at', recBefore)
  if (l.error) throw new Error(`수집 기록 정리: ${l.error.message}`)
  if (r.error) throw new Error(`삭제 기록 정리: ${r.error.message}`)
  // 사용 행동 기록 (표가 아직 없으면 넘어감)
  const evBefore = new Date(now - EVENT_LOG_KEEP_DAYS * DAY).toISOString()
  const e = await db.from('events').delete({ count: 'exact' }).lt('created_at', evBefore)
  // 추가 완료·거절된 매장 신청 (처리한 날 기준, 처리 시각이 없으면 신청한 날 기준). 대기·실패는 남김
  const reqBefore = new Date(now - REQUEST_KEEP_DAYS * DAY).toISOString()
  const q = await db
    .from('shop_requests')
    .delete({ count: 'exact' })
    .in('status', ['done', 'rejected'])
    .or(`reviewed_at.lt.${reqBefore},and(reviewed_at.is.null,created_at.lt.${reqBefore})`)
  if (q.error) throw new Error(`매장 신청 기록 정리: ${q.error.message}`)
  // 자동으로 걸러진 스팸 의견 (17-feedback-filter.sql 전이면 0)
  const s = await db.from('feedback').delete({ count: 'exact' }).eq('status', 'spam').lt('created_at', new Date(now - SPAM_KEEP_DAYS * DAY).toISOString())
  return { logs: l.count ?? 0, records: r.count ?? 0, events: e.error ? 0 : e.count ?? 0, requests: q.count ?? 0, spam: s.error ? 0 : s.count ?? 0 }
}

// 이미 지운 글 코드 목록 (크롤러가 다시 넣지 않도록)
export async function loadDeletedCodes() {
  const { data, error } = await db.from('deleted_posts').select('code')
  if (error) return new Set() // 표가 아직 없으면 빈 목록
  return new Set(data.map((r) => r.code))
}

// 지운 글(또는 수집하지 않을 글)로 기록 → 다음 수집 때 다시 들어오지 않음
export async function recordDeleted(posts) {
  if (posts.length === 0) return
  const rec = await db
    .from('deleted_posts')
    .upsert(posts.map((p) => ({ code: p.code, account_username: p.account_username ?? p.owner ?? null })))
  if (rec.error) throw new Error(`삭제 기록 저장: ${rec.error.message}`)
}

// 본문이 비어 있는 글 (수집하지 않음)
export const hasNoCaption = (post) => !(post.caption ?? '').trim()

// 반환: 지운 글 목록 [{ code, account_username, category }]
export async function deleteExpiredPosts(now = Date.now()) {
  const { data, error } = await db
    .from('posts')
    .select('code, account_username, category, posted_at, starts_at, ends_at, image_path')
    .limit(10000)
  if (error) throw new Error(`오래된 글 확인: ${error.message}`)

  const expired = data.filter((p) => expiresAt(p) < now)
  if (expired.length === 0) return []

  // 1) 다시 들어오지 않게 코드 기록 (실패하면 여기서 멈춰서 아무것도 지우지 않음)
  await recordDeleted(expired)

  // 2) 사진 삭제 (실패해도 글 삭제는 진행)
  const paths = expired.map((p) => p.image_path).filter(Boolean)
  if (paths.length) await db.storage.from('post-images').remove(paths)

  // 3) 글 삭제
  const del = await db.from('posts').delete().in('code', expired.map((p) => p.code))
  if (del.error) throw new Error(`글 삭제: ${del.error.message}`)
  return expired
}

// 기록용 요약: "입고 2, 콜라보·팝업 1"
export function summarize(removed) {
  const c = {}
  for (const p of removed) c[p.category] = (c[p.category] ?? 0) + 1
  return Object.entries(c)
    .map(([k, v]) => `${k} ${v}`)
    .join(', ')
}
