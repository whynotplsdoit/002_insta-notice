// 사용 행동 기록 (관리자 화면 "통계" 탭용)
// - 개인 정보 없이 브라우저별 무작위 번호만 사용
// - 모아서 몇 초마다 한 번에 보내고, 페이지를 떠날 때 남은 것도 보냄
// - 관리자 화면(/admin)과 개발 중(localhost)에는 기록하지 않음
const url = import.meta.env.SUPABASE_URL
const key = import.meta.env.SUPABASE_PUBLISHABLE_KEY
const FLUSH_MS = 4000

const enabled =
  Boolean(url && key) && typeof window !== 'undefined' && !location.pathname.startsWith('/admin') && location.hostname !== 'localhost'

const randomId = () =>
  (crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`).replace(/-/g, '').slice(0, 24)

function storedId(storage, name) {
  try {
    let id = storage.getItem(name)
    if (!id) {
      id = randomId()
      storage.setItem(name, id)
    }
    return id
  } catch {
    return randomId() // 저장이 막혀 있으면 매번 새 번호
  }
}

const visitorId = enabled ? storedId(localStorage, 'goods-radar:vid') : ''
const sessionId = enabled ? storedId(sessionStorage, 'goods-radar:sid') : ''
const device = () => (window.innerWidth < 600 ? 'mobile' : window.innerWidth < 1024 ? 'tablet' : 'pc')

let queue = []
let timer = null

function flush() {
  timer = null
  if (!queue.length) return
  const rows = queue
  queue = []
  fetch(`${url}/rest/v1/events`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(rows),
    keepalive: true, // 페이지를 떠나는 중에도 보내기
  }).catch(() => {}) // 기록 실패는 사용자에게 영향 없음
}

export function track(type, target = null, meta = null) {
  if (!enabled) return
  queue.push({
    visitor_id: visitorId,
    session_id: sessionId,
    type,
    target: target == null ? null : String(target).slice(0, 100),
    meta,
    device: device(),
  })
  if (!timer) timer = setTimeout(flush, FLUSH_MS)
}

if (enabled) {
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush())
  window.addEventListener('pagehide', flush)
  // 방문 1회 (같은 탭에서 새로고침해도 한 번만)
  try {
    if (!sessionStorage.getItem('goods-radar:visited')) {
      sessionStorage.setItem('goods-radar:visited', '1')
      track('visit', null, { ref: document.referrer ? new URL(document.referrer).hostname : null })
    }
  } catch {
    track('visit')
  }
}
