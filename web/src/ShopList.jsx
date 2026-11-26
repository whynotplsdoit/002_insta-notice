// 매장 목록 ("매장" 탭의 [목록]): 등록된 모든 매장을 글이 있든 없든 보여줌
// - 카드: 프로필 사진 · 이름 · 종류·지역 · 영업 상태 · 최근 소식 배지 · 최근 글 · 글 수 → 누르면 매장 정보 창
// - 종류 필터(매장 종류가 2개 이상일 때), 정렬: 최근 소식순 / 가나다순 / 가까운 순(누를 때만 위치 권한)
// - 지역·매장 필터와 검색어는 바깥(필터 패널·검색창) 것을 그대로 받음
import { useMemo, useState } from 'react'
import { imageUrl } from './supabase.js'
import { openStatus } from './hours.js'
import { track } from './track.js'

const SORTS = [
  { id: 'recent', label: '최근 소식순' },
  { id: 'name', label: '가나다순' },
  { id: 'near', label: '가까운 순' },
]
const RECENT_DAYS = 7
const DAY = 86400000
// 영업 상태 우선순위 (지점이 여러 곳이면 가장 좋은 상태)
const STATUS_RANK = { open: 0, before: 1, closed: 2, off: 3, unknown: 4 }

// 두 좌표 사이 거리 (km)
function distanceKm(a, b) {
  const rad = (d) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(h))
}
const fmtKm = (km) => (km < 1 ? `${Math.round(km * 1000)}m` : `${km < 10 ? km.toFixed(1) : Math.round(km)}km`)
const fmtAgo = (ms) => {
  const d = Math.floor(ms / DAY)
  return d <= 0 ? '오늘' : d === 1 ? '어제' : d < 30 ? `${d}일 전` : `${Math.floor(d / 30)}달 전`
}

export default function ShopList({ accounts, branches, posts, regions, shops, query, now, onShopOpen }) {
  const [type, setType] = useState(null) // null = 전체 종류
  const [sort, setSort] = useState('recent')
  const [here, setHere] = useState(null) // { lat, lng }
  const [locState, setLocState] = useState('idle') // idle | asking | denied

  // 매장별 지점·글 정리
  const rows = useMemo(() => {
    const byShop = new Map(accounts.map((a) => [a.username, { account: a, branches: [], count: 0, latest: 0 }]))
    for (const b of branches) byShop.get(b.account_username)?.branches.push(b)
    for (const p of posts) {
      const r = byShop.get(p.account_username)
      if (!r) continue
      r.count++
      r.latest = Math.max(r.latest, new Date(p.posted_at).getTime())
    }
    return [...byShop.values()].map((r) => {
      const statuses = r.branches.map((b) => openStatus(b.hours, now))
      const status = statuses.sort((a, b) => STATUS_RANK[a.kind] - STATUS_RANK[b.kind])[0] ?? { kind: 'unknown', text: '영업시간 정보 없음' }
      return {
        ...r,
        status,
        regions: [...new Set(r.branches.map((b) => b.region).filter(Boolean))],
        recent: r.latest > 0 && now - r.latest < RECENT_DAYS * DAY,
        type: r.account.account_type || '굿즈샵',
      }
    })
  }, [accounts, branches, posts, now])

  const types = useMemo(() => [...new Set(rows.map((r) => r.type))], [rows])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/\s+/g, '')
    const list = rows.filter((r) => {
      if (type && r.type !== type) return false
      if (shops !== null && !shops.includes(r.account.username)) return false
      if (regions.length && !r.regions.some((x) => regions.includes(x))) return false
      if (q) {
        const hay = [r.account.display_name, r.account.username, r.account.ig_full_name, ...r.regions, ...r.branches.map((b) => b.name)]
          .join(' ')
          .toLowerCase()
          .replace(/\s+/g, '')
        if (!hay.includes(q)) return false
      }
      return true
    })
    const withDist = list.map((r) => {
      const pts = r.branches.filter((b) => b.lat != null && b.lng != null)
      const dist = here && pts.length ? Math.min(...pts.map((b) => distanceKm(here, { lat: b.lat, lng: b.lng }))) : null
      return { ...r, dist }
    })
    const byName = (a, b) => a.account.display_name.localeCompare(b.account.display_name, 'ko')
    if (sort === 'name') return withDist.sort(byName)
    if (sort === 'near' && here) return withDist.sort((a, b) => (a.dist ?? Infinity) - (b.dist ?? Infinity) || byName(a, b))
    return withDist.sort((a, b) => b.latest - a.latest || byName(a, b))
  }, [rows, type, shops, regions, query, sort, here])

  const pickSort = (id) => {
    track('sort', `shops:${id}`)
    if (id !== 'near' || here) return setSort(id)
    if (!navigator.geolocation) return setLocState('denied')
    setLocState('asking')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setHere({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        setLocState('idle')
        setSort('near')
      },
      () => setLocState('denied'),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
    )
  }

  return (
    <div className="shop-dir">
      <div className="shop-dir-tools">
        {types.length > 1 && (
          <div className="chips" role="group" aria-label="매장 종류">
            {[null, ...types].map((t) => (
              <button
                key={t ?? 'all'}
                type="button"
                className={`chip${type === t ? ' on' : ''}`}
                aria-pressed={type === t}
                onClick={() => {
                  setType(t)
                  track('filter', 'shop_type', { value: t ?? 'all' })
                }}
              >
                {t ?? '전체'}
              </button>
            ))}
          </div>
        )}
        <div className="toolbar">
          <span className="result-count">
            {visible.length === rows.length ? (
              `매장 ${rows.length}곳`
            ) : (
              <>
                <b>{visible.length}</b> / {rows.length}곳
              </>
            )}
          </span>
          <div className="segmented" role="group" aria-label="매장 정렬">
            {SORTS.map((s) => (
              <button key={s.id} type="button" className={sort === s.id ? 'on' : ''} aria-pressed={sort === s.id} onClick={() => pickSort(s.id)}>
                {s.id === 'near' && locState === 'asking' ? '찾는 중…' : s.label}
              </button>
            ))}
          </div>
        </div>
        {locState === 'denied' && <p className="shop-dir-note">위치를 가져오지 못했어요. 브라우저에서 위치 권한을 허용하면 가까운 순으로 볼 수 있어요.</p>}
      </div>

      {visible.length === 0 ? (
        <div className="state">
          <p>조건에 맞는 매장이 없습니다.</p>
        </div>
      ) : (
        <ul className="shop-cards">
          {visible.map((r) => {
            const a = r.account
            const photo = a.profile_image_path ? `${imageUrl(a.profile_image_path)}?v=${encodeURIComponent(a.profile_updated_at ?? '')}` : null
            return (
              <li key={a.username}>
                <button type="button" className="shop-card" onClick={() => onShopOpen(a.username)}>
                  {photo ? (
                    <img className="shop-card-photo" src={photo} alt="" loading="lazy" />
                  ) : (
                    <span className="shop-card-photo placeholder">{a.display_name[0]}</span>
                  )}
                  <span className="shop-card-body">
                    <span className="shop-card-top">
                      <span className="shop-card-name">{a.display_name}</span>
                      {r.recent && <span className="badge-recent">최근 소식</span>}
                    </span>
                    <span className="shop-card-meta">
                      {[r.type, r.regions.join('·') || null, r.branches.length > 1 ? `지점 ${r.branches.length}곳` : null, r.dist != null ? fmtKm(r.dist) : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                    <span className="shop-card-meta wrap">
                      <span className={`open-status ${r.status.kind}`}>{r.status.kind === 'unknown' ? '영업시간 정보 없음' : r.status.text}</span>
                      <span className="dot">·</span>
                      {r.count ? `최근 글 ${fmtAgo(now - r.latest)} · 소식 ${r.count}개` : '아직 모은 소식 없음'}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
