// 쓰레드(Threads) 공식 API — 슬랙 봇·저녁 초안이 같이 씀 (파일 이름이 _ 로 시작해 주소로 열리지 않음)
// 토큰은 Supabase sns_tokens 표 (supabase/21-sns.sql), PC 에서 npm run threads:auth 로 넣음
const API = 'https://graph.threads.net/v1.0'
const REFRESH_EVERY_DAYS = 7

async function getRow(db) {
  const { data, error } = await db.from('sns_tokens').select('*').eq('platform', 'threads').maybeSingle()
  if (error) throw new Error(`토큰 표 읽기 실패: ${error.message}`)
  if (!data) throw new Error('쓰레드 토큰이 없어요 (PC 에서 npm run threads:auth)')
  return data
}

async function call(db, method, path, params = {}) {
  const { access_token } = await getRow(db)
  const q = new URLSearchParams({ ...params, access_token })
  const res = await fetch(`${API}${path}?${q}`, { method })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || body.error) throw new Error(body.error?.message || `HTTP ${res.status}`)
  return body
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 글자 글 올리기 → { id, permalink }
export async function postText(db, text) {
  const t = String(text ?? '').trim()
  if (!t || [...t].length > 500) throw new Error(`글은 1~500자여야 해요 (지금 ${[...t].length}자)`)
  const { user_id } = await getRow(db)
  const { id: creationId } = await call(db, 'POST', `/${user_id}/threads`, { media_type: 'TEXT', text: t })
  let id
  for (let i = 0; i < 4 && !id; i++) {
    try {
      id = (await call(db, 'POST', `/${user_id}/threads_publish`, { creation_id: creationId })).id
    } catch (e) {
      if (i === 3) throw e
      await sleep(1500) // 아직 준비 중이면 잠깐 기다렸다 다시
    }
  }
  const { permalink } = await call(db, 'GET', `/${id}`, { fields: 'permalink' })
  return { id, permalink }
}

export const deletePost = (db, id) => call(db, 'DELETE', `/${id}`)

export async function listPosts(db, limit = 5) {
  const { user_id } = await getRow(db)
  const { data } = await call(db, 'GET', `/${user_id}/threads`, { fields: 'id,text,timestamp,permalink', limit: String(limit) })
  return data ?? []
}

export async function postStats(db, id) {
  const { data } = await call(db, 'GET', `/${id}/insights`, { metric: 'views,likes,replies,reposts' })
  return Object.fromEntries((data ?? []).map((m) => [m.name, m.values?.[0]?.value ?? m.total_value?.value ?? 0]))
}

// 7일 넘었으면 토큰 갱신 (60일 연장). 반환: 'skip' | 'refreshed'
export async function refreshIfNeeded(db) {
  const row = await getRow(db)
  if (Date.now() - new Date(row.refreshed_at).getTime() < REFRESH_EVERY_DAYS * 86400000) return 'skip'
  const q = new URLSearchParams({ grant_type: 'th_refresh_token', access_token: row.access_token })
  const r = await (await fetch(`https://graph.threads.net/refresh_access_token?${q}`)).json()
  if (r.error || !r.access_token) throw new Error(r.error?.message || '토큰 갱신 실패')
  const { error } = await db
    .from('sns_tokens')
    .update({ access_token: r.access_token, expires_at: new Date(Date.now() + r.expires_in * 1000).toISOString(), refreshed_at: new Date().toISOString() })
    .eq('platform', 'threads')
  if (error) throw new Error(`갱신한 토큰 저장 실패: ${error.message}`)
  return 'refreshed'
}

export async function tokenInfo(db) {
  const { expires_at, refreshed_at } = await getRow(db)
  return { expires_at, refreshed_at }
}
