// 굿즈레이더 서비스 워커 (홈 화면 앱용)
// - 화면 파일(HTML·JS·CSS·아이콘)만 휴대폰에 저장해 빠르게 열기
// - 소식 데이터(Supabase)와 사진은 저장하지 않고 항상 새로 받음
// - 페이지(HTML)는 "새로 받기 먼저, 안 되면 저장본" → 배포하면 바로 새 버전이 보임
const CACHE = 'goods-radar-v1'
const SHELL = ['/manifest.webmanifest', '/favicon-32.png', '/favicon-64.png', '/icon-192.png', '/icon-512.png']

// 페이지(HTML)와 그 페이지가 쓰는 화면 파일(/assets/…)을 함께 저장
// res 를 주면 그 응답을 쓰고, 없으면 새로 받음. 이미 저장된 화면 파일은 다시 받지 않음
async function cachePage(cache, res) {
  res = res ?? (await fetch('/', { cache: 'no-store' }))
  if (!res.ok) return
  const html = await res.clone().text()
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1])
  await cache.put('/', res)
  const missing = []
  for (const a of assets) if (!(await cache.match(a))) missing.push(a)
  if (missing.length) await cache.addAll(missing)
}

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(async (c) => {
    await c.addAll(SHELL)
    await cachePage(c)
  }))
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  // 예전 버전 저장본 지우기
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return // Supabase·인스타 사진 등은 건드리지 않음
  if (url.pathname.startsWith('/_vercel/') || url.pathname.startsWith('/admin')) return

  // 페이지: 새로 받기 먼저, 인터넷이 안 되면 저장본 (새 버전이 배포되면 그 화면 파일도 저장)
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && url.pathname === '/') {
            const copy = res.clone()
            e.waitUntil(caches.open(CACHE).then((c) => cachePage(c, copy)).catch(() => {}))
          }
          return res
        })
        .catch(() => caches.match('/')),
    )
    return
  }

  // 화면 파일(/assets/… 는 이름에 버전이 붙어 있어 바뀌지 않음): 저장본 먼저
  e.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok && (url.pathname.startsWith('/assets/') || /\.(png|svg|webmanifest)$/.test(url.pathname))) {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(req, copy))
          }
          return res
        }),
    ),
  )
})
