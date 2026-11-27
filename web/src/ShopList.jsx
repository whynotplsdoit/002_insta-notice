// 매장 목록 ("매장" 탭의 [목록]): 등록된 모든 매장을 글이 있든 없든 보여줌
// - 지역·매장 종류·상품 종류(그 상품을 다루는 매장)·단골 매장은 필터 창(모든 메뉴 공통)을 따름 / 위: 정렬(최근 소식순·가나다순)
// - 기본: 시·도별로 묶어서 접기·펼치기 (즐겨찾기가 있는 시·도, 없으면 매장 많은 시·도만 처음에 펼침)
//   시·도 안에 지역이 여럿이면 세부 지역 칩, 한 번에 30곳씩 그리고 [더 보기]
// - 검색어가 있거나 단골 매장만 볼 때는 묶지 않고 한 목록
import { useMemo, useState } from 'react'
import { imageUrl } from './supabase.js'
import { openStatus } from './hours.js'
import { track } from './track.js'
import { FavButton } from './favorites.jsx'
import { branchSido, groupRegions, ONLINE, sidoOfRegionMap, shopTypeOf } from './regions.js'

const SORTS = [
  { id: 'recent', label: '최근 소식순' },
  { id: 'name', label: '가나다순' },
]
const RECENT_DAYS = 7
const DAY = 86400000
const PAGE = 30 // 한 묶음에 처음 보여줄 매장 수
// 영업 상태 우선순위 (지점이 여러 곳이면 가장 좋은 상태)
const STATUS_RANK = { open: 0, before: 1, closed: 2, off: 3, unknown: 4, online: 5 }

const fmtKm = (km) => (km < 1 ? `${Math.round(km * 1000)}m` : `${km < 10 ? km.toFixed(1) : Math.round(km)}km`)
const fmtAgo = (ms) => {
  const d = Math.floor(ms / DAY)
  return d <= 0 ? '오늘' : d === 1 ? '어제' : d < 30 ? `${d}일 전` : `${Math.floor(d / 30)}달 전`
}

export default function ShopList({ accounts, branches, posts, regions, shopKinds, goodsTypes, goodsOfShop, favOnly, onClearFilters, query, now, isFav, favCount, onToggleFav, onShopOpen }) {
  const [sort, setSort] = useState('recent')
  const [opened, setOpened] = useState(null) // 펼친 시·도 (null = 아직 안 건드림 → 기본값)
  const [subPick, setSubPick] = useState({}) // 시·도 → 고른 세부 지역
  const [shownOf, setShownOf] = useState({}) // 묶음 → 보여줄 수

  const regionGroups = useMemo(() => groupRegions(branches), [branches])
  const regionMap = useMemo(() => sidoOfRegionMap(branches), [branches])

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
      // 지역이 "온라인"인 지점 = 오프라인 매장 없음 (ShopInfo ONLINE)
      const statuses = r.branches.map((b) => (b.region === ONLINE ? { kind: 'online', text: '온라인 매장' } : openStatus(b.hours, now)))
      const status = statuses.sort((a, b) => STATUS_RANK[a.kind] - STATUS_RANK[b.kind])[0] ?? { kind: 'unknown', text: '영업시간 정보 없음' }
      return {
        ...r,
        status,
        regions: [...new Set(r.branches.map((b) => b.region).filter(Boolean))],
        sidos: [...new Set(r.branches.map((b) => branchSido(b, regionMap)))],
        recent: r.latest > 0 && now - r.latest < RECENT_DAYS * DAY,
        type: shopTypeOf(r.account),
      }
    })
  }, [accounts, branches, posts, now, regionMap])

  // 필터 창(지역·매장 종류·상품 종류·단골 매장)·검색어로 거른 매장
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/\s+/g, '')
    return rows
      .filter((r) => {
        if (favOnly && !isFav(r.account.username)) return false
        if (shopKinds.length && !shopKinds.includes(r.type)) return false
        if (goodsTypes.length && !goodsTypes.some((t) => goodsOfShop.get(r.account.username)?.has(t))) return false
        if (regions.length && !r.regions.some((x) => regions.includes(x))) return false
        if (q) {
          const hay = [r.account.display_name, r.account.username, r.account.ig_full_name, ...r.regions, ...r.sidos, ...r.branches.map((b) => b.name)]
            .join(' ')
            .toLowerCase()
            .replace(/\s+/g, '')
          if (!hay.includes(q)) return false
        }
        return true
      })
  }, [rows, favOnly, shopKinds, goodsTypes, goodsOfShop, isFav, regions, query])

  const byName = (a, b) => a.account.display_name.localeCompare(b.account.display_name, 'ko')
  const sortList = (list) => list.slice().sort(sort === 'name' ? byName : (a, b) => b.latest - a.latest || byName(a, b))

  const flat = query.trim() !== '' || favOnly

  // 시·도 묶음 (매장 수 많은 순, 지점이 여러 시·도에 있으면 각각에 나옴)
  const sections = useMemo(() => {
    const list = regionGroups
      .map(([sido, subs]) => ({ sido, subs, shops: filtered.filter((r) => r.sidos.includes(sido)) }))
      .filter((s) => s.shops.length)
    const noRegion = filtered.filter((r) => r.sidos.length === 0)
    if (noRegion.length) list.push({ sido: '지역 미정', subs: [], shops: noRegion })
    return list
  }, [regionGroups, filtered])

  // 처음 펼칠 시·도: 즐겨찾기 매장이 있는 곳, 없으면 매장 가장 많은 곳
  const defaultOpen = useMemo(() => {
    const favSidos = sections.filter((s) => s.shops.some((r) => isFav(r.account.username))).map((s) => s.sido)
    return new Set(favSidos.length ? favSidos : sections.slice(0, 1).map((s) => s.sido))
  }, [sections, isFav])
  const openSet = opened ?? defaultOpen
  const toggleOpen = (sido) => {
    const next = new Set(openSet)
    next.has(sido) ? next.delete(sido) : next.add(sido)
    setOpened(next)
    track('filter', 'shop_section', { value: sido, on: next.has(sido) })
  }

  const card = (r, key) => (
    <ShopCard key={key ?? r.account.username} r={r} now={now} fav={isFav(r.account.username)} onToggleFav={onToggleFav} onShopOpen={onShopOpen} />
  )
  // 한 묶음 그리기: 처음 30곳, [더 보기]로 30곳씩
  const pageOf = (id, list) => {
    const shown = shownOf[id] ?? PAGE
    return (
      <>
        <ul className="shop-cards">{list.slice(0, shown).map((r) => card(r, `${id}-${r.account.username}`))}</ul>
        {list.length > shown && (
          <button type="button" className="btn shop-more" onClick={() => setShownOf({ ...shownOf, [id]: shown + PAGE })}>
            더 보기 ({list.length - shown}곳 남음)
          </button>
        )}
      </>
    )
  }

  const shownSections = sections
  const empty = filtered.length === 0

  return (
    <div className="shop-dir">
      <div className="shop-dir-tools">
        <div className="toolbar">
          <span className="result-count">
            {filtered.length === rows.length ? `매장 ${rows.length}곳` : `${filtered.length} / ${rows.length}곳`}
          </span>
          {(
            <div className="segmented" role="group" aria-label="매장 정렬">
              {SORTS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={sort === s.id ? 'on' : ''}
                  aria-pressed={sort === s.id}
                  onClick={() => {
                    setSort(s.id)
                    track('sort', `shops:${s.id}`)
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {empty ? (
        <div className="state">
          <p>{favOnly && favCount === 0 ? '아직 단골 매장이 없어요. 매장 카드의 하트를 눌러 단골 매장을 추가해 보세요.' : '조건에 맞는 매장이 없습니다.'}</p>
          {(favOnly || shopKinds.length > 0 || goodsTypes.length > 0 || regions.length > 0) && (
            <button type="button" className="btn" onClick={onClearFilters}>
              전체 매장 보기
            </button>
          )}
        </div>
      ) : flat ? (
        pageOf('flat', sortList(filtered))
      ) : (
        shownSections.map((s) => {
          const open = openSet.has(s.sido)
          const sub = subPick[s.sido]
          const list = sortList(sub ? s.shops.filter((r) => r.regions.includes(sub)) : s.shops)
          return (
            <section key={s.sido} className="shop-section">
              <button type="button" className="shop-section-head" aria-expanded={open} onClick={() => toggleOpen(s.sido)}>
                <span>
                  {s.sido} <span className="count">{s.shops.length}곳</span>
                </span>
                <span className="shop-section-toggle">{open ? '접기 ▴' : '펼치기 ▾'}</span>
              </button>
              {open && (
                <>
                  {s.subs.length > 1 && (
                    <div className="chips sub-chips" role="group" aria-label={`${s.sido} 세부 지역`}>
                      {[null, ...s.subs].map((x) => (
                        <button
                          key={x ?? 'all'}
                          type="button"
                          className={`chip${(sub ?? null) === x ? ' on' : ''}`}
                          onClick={() => setSubPick({ ...subPick, [s.sido]: x })}
                        >
                          {x ?? `${s.sido} 전체`}
                          {x && <span className="chip-count">{s.shops.filter((r) => r.regions.includes(x)).length}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                  {pageOf(`${s.sido}/${sub ?? ''}`, list)}
                </>
              )}
            </section>
          )
        })
      )}
    </div>
  )
}

function ShopCard({ r, now, fav, onToggleFav, onShopOpen }) {
  const a = r.account
  const photo = a.profile_image_path ? `${imageUrl(a.profile_image_path)}?v=${encodeURIComponent(a.profile_updated_at ?? '')}` : null
  return (
    <li className="shop-card-wrap">
      <FavButton on={fav} onToggle={() => onToggleFav(a.username)} name={a.display_name} className="on-card" />
      <button type="button" className="shop-card" onClick={() => onShopOpen(a.username)}>
        {photo ? <img className="shop-card-photo" src={photo} alt="" loading="lazy" /> : <span className="shop-card-photo placeholder">{a.display_name[0]}</span>}
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
}
