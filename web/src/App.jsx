import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { configured } from './supabase.js'
import { usePosts } from './usePosts.js'
import PostCard from './PostCard.jsx'
import RequestShop from './RequestShop.jsx'
import Feedback from './Feedback.jsx'
import ShopInfo from './ShopInfo.jsx'
import PostDetail from './PostDetail.jsx'
import InstallPrompt from './InstallPrompt.jsx'
import { track } from './track.js'
import { BoxIcon, MapPinIcon, MegaphoneIcon, RadarIcon, SearchIcon, SlidersIcon, StoreIcon } from './icons.jsx'
import MapView from './MapView.jsx'
import ShopList from './ShopList.jsx'
import { useFavorites } from './favorites.jsx'
import { groupRegions, ONLINE } from './regions.js'
import { GROUPS, scheduleOf, sortByPosted, sortBySchedule } from './sort.js'

const SORTS = [
  { id: 'schedule', label: '일정순' },
  { id: 'posted', label: '최신순' },
]

const TABS = [
  { id: '전체', label: '전체', Icon: RadarIcon },
  { id: '입고', label: '입고', Icon: BoxIcon },
  { id: '콜라보·팝업', label: '콜라보·팝업', Icon: StoreIcon },
  { id: '이벤트·안내', label: '이벤트·안내', Icon: MegaphoneIcon },
  { id: 'map', label: '매장', Icon: MapPinIcon }, // 글 목록 대신 매장 [목록 | 지도] (예전 저장값과 맞추려고 id 는 map 유지)
]
const GOODS_TYPES = ['쿠지', '가챠', '피규어', '굿즈']
const STORAGE_KEY = 'goods-feed:filters:v2'
const CONTACT_EMAIL = 'whynot.plsdoit@gmail.com' // 게시 중단 요청 받는 메일
const PAGE_SIZE = 30 // 한 번에 보여줄 글 수
const NEW_MS = 24 * 3600_000 // 24시간 안에 처음 수집된 글은 "NEW"

// 탭·필터는 이 브라우저에만 기억 (저장이 막혀 있어도 정상 동작)
function loadSaved() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {}
  } catch {
    return {}
  }
}

export default function App() {
  if (!configured) {
    return (
      <div className="state">
        <p>Supabase 연결 정보가 없습니다.</p>
        <p className="muted">상위 폴더 .env 의 SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY 를 확인하세요.</p>
      </div>
    )
  }
  return <Feed />
}

function Feed() {
  const { posts, accounts, branches, pending, showPending, status, live, reload } = usePosts()
  const saved = useMemo(loadSaved, [])
  const [tab, setTab] = useState(saved.tab ?? '전체')
  const [types, setTypes] = useState(saved.types ?? [])
  const [regions, setRegions] = useState(saved.regions ?? [])
  // 즐겨찾기 매장 (이 브라우저에만 저장) + "즐겨찾기 매장 소식만" 켜기
  // 예전 필터에서 매장을 골라 둔 사람은 그 매장이 즐겨찾기로 옮겨지고 켜진 상태로 시작
  const { favorites, isFav, toggleFav } = useFavorites()
  const [favOnly, setFavOnly] = useState(saved.favOnly ?? (Array.isArray(saved.shops) && saved.shops.length > 0))
  const [openSido, setOpenSido] = useState(null) // 지역 필터에서 펼친 시·도
  const [toast, setToast] = useState('')
  const [query, setQuery] = useState('')
  const [hidePast, setHidePast] = useState(saved.hidePast ?? false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const filtersRef = useRef(null)
  const filterBtnRef = useRef(null)
  // 필터 창 밖(머리글의 탭·검색창 등)을 누르면 필터 닫기
  useEffect(() => {
    if (!filtersOpen) return
    const onDown = (e) => {
      if (filtersRef.current?.contains(e.target) || filterBtnRef.current?.contains(e.target)) return
      setFiltersOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    // 필터가 열려 있는 동안 뒤 목록 스크롤 막기
    // (body 를 고정하면 머리글이 같이 밀려 올라가서, 페이지 스크롤만 멈춤)
    const html = document.documentElement
    html.style.overflow = 'hidden'
    const blockTouch = (e) => {
      if (!filtersRef.current?.contains(e.target)) e.preventDefault()
    }
    document.addEventListener('touchmove', blockTouch, { passive: false })
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('touchmove', blockTouch)
      html.style.overflow = ''
    }
  }, [filtersOpen])
  const [requestOpen, setRequestOpen] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [shopInfo, setShopInfo] = useState(null) // { username, branches: 글에 적힌 지점 }
  const [detail, setDetail] = useState(null) // 상세 창에 연 글
  const [sortMode, setSortMode] = useState(saved.sortMode === 'posted' ? 'posted' : 'schedule')
  const [shopView, setShopView] = useState(saved.shopView === 'map' ? 'map' : 'list') // 매장 탭: 목록 | 지도
  const [now, setNow] = useState(Date.now())

  // 자정이 지나도 "오늘" 기준이 맞도록 1분마다 현재 시각 갱신
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ tab, types, regions, favOnly, hidePast, sortMode, shopView }))
    } catch {
      // 저장 못 해도 괜찮음
    }
  }, [tab, types, regions, favOnly, hidePast, sortMode, shopView])

  // 별 누르기: 처음 추가할 때 한 번 "이 브라우저에 저장돼요" 안내
  const toastTimer = useRef(null)
  const onToggleFav = (username) => {
    const on = toggleFav(username)
    track('filter', 'favorite', { value: username, on })
    let first = false
    try {
      first = on && !localStorage.getItem('goods-radar:fav-tip')
      if (first) localStorage.setItem('goods-radar:fav-tip', '1')
    } catch {
      first = false
    }
    setToast(on ? (first ? '즐겨찾기에 추가했어요 · 이 브라우저에 저장돼요' : '즐겨찾기에 추가했어요') : '즐겨찾기에서 뺐어요')
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), first ? 3500 : 1800)
  }
  const goShops = () => {
    setFiltersOpen(false)
    setShopView('list')
    selectTab('map')
  }

  // 검색어 기록: 입력을 멈추고 1.5초 지나면 한 번 (2글자 이상)
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) return
    const t = setTimeout(() => track('search', q), 1500)
    return () => clearTimeout(t)
  }, [query])

  const shopOf = useMemo(() => new Map(accounts.map((a) => [a.username, a])), [accounts])
  const branchCount = useMemo(() => {
    const m = new Map()
    for (const b of branches) m.set(b.account_username, (m.get(b.account_username) ?? 0) + 1)
    return m
  }, [branches])
  const regionOf = useMemo(() => {
    const m = new Map()
    for (const b of branches) m.set(`${b.account_username}/${b.name}`, b.region)
    return m
  }, [branches])
  // 지역을 시·도로 묶기: [['서울', ['홍대', '잠실']], ['부산', ['부산']], ...] (매장 많은 시·도부터)
  const regionGroups = useMemo(() => groupRegions(branches), [branches])
  const postCountOf = useMemo(() => {
    const m = new Map()
    for (const p of posts) m.set(p.account_username, (m.get(p.account_username) ?? 0) + 1)
    return m
  }, [posts])

  const postRegions = (p) => {
    const list = p.branches.map((name) => regionOf.get(`${p.account_username}/${name}`)).filter(Boolean)
    return list.length ? list : branches.filter((b) => b.account_username === p.account_username).map((b) => b.region)
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/\s+/g, '')
    const now = Date.now()
    return posts.filter((p) => {
      if (tab === '전체' ? false : p.category !== tab) return false
      if (tab === '입고' && types.length && !p.goods_type.some((t) => types.includes(t))) return false
      if (favOnly && !favorites.includes(p.account_username)) return false
      if (regions.length && !postRegions(p).some((r) => regions.includes(r))) return false
      if (hidePast && p.starts_at && scheduleOf(p, now).group === 'past') return false
      if (q) {
        const hay = [p.caption, ...p.works, shopOf.get(p.account_username)?.display_name]
          .join(' ')
          .toLowerCase()
          .replace(/\s+/g, '')
        if (!hay.includes(q)) return false
      }
      return true
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posts, tab, types, regions, favOnly, favorites, query, hidePast, shopOf, regionOf])

  const sorted = useMemo(
    () => (sortMode === 'posted' ? sortByPosted(visible) : sortBySchedule(visible, now)),
    [visible, sortMode, now],
  )

  // 지도 탭: 글 목록 대신 매장 지도 (지역·매장 필터는 지도에도 적용)
  const isMap = tab === 'map'
  const listReady = status === 'ready' && !isMap
  const mapBranches = useMemo(
    () =>
      branches.filter(
        (b) => regions.length === 0 || regions.includes(b.region),
      ),
    [branches, regions],
  )

  // 구역별 개수 (오늘·진행 중 / 앞으로 예정 / 지난 소식)
  const groupCount = useMemo(() => {
    const c = { today: 0, upcoming: 0, past: 0 }
    for (const x of sorted) if (x.group) c[x.group]++
    return c
  }, [sorted])

  // 지난 소식은 처음에 접어 둠 (일정순일 때만)
  // 단, 지난 소식밖에 없으면 빈 화면이 되지 않도록 펼쳐서 보여줌
  const [pastOpen, setPastOpen] = useState(false)
  const onlyPast = groupCount.past > 0 && groupCount.past === sorted.length
  const pastHidden = sortMode === 'schedule' && !pastOpen && !onlyPast && groupCount.past > 0
  const list = useMemo(() => (pastHidden ? sorted.filter((x) => x.group !== 'past') : sorted), [sorted, pastHidden])

  // 30개씩 보여주기: 조건이 바뀌면 처음 30개부터
  const [shown, setShown] = useState(PAGE_SIZE)
  useEffect(() => {
    setShown(PAGE_SIZE)
  }, [tab, types, regions, favOnly, query, hidePast, sortMode])
  const page = list.slice(0, shown)

  // 목록 끝(더 보기 자리)이 화면에 가까워지면 자동으로 다음 30개
  const moreRef = useRef(null)
  useEffect(() => {
    const el = moreRef.current
    if (!el || !('IntersectionObserver' in window)) return
    const io = new IntersectionObserver((entries) => entries[0].isIntersecting && setShown((n) => n + PAGE_SIZE), {
      rootMargin: '600px 0px',
    })
    io.observe(el)
    return () => io.disconnect()
  }, [shown, list.length])

  // 지난 소식을 펼치면 펼친 자리부터 30개 더
  useEffect(() => {
    if (pastOpen) setShown((n) => Math.max(n, list.length - groupCount.past + PAGE_SIZE))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pastOpen])

  // 맨 위로 버튼: 한 화면 반 이상 내려가면 보임
  const [showTop, setShowTop] = useState(false)
  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > window.innerHeight * 1.5)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const counts = useMemo(() => {
    const c = { 전체: posts.length }
    for (const p of posts) c[p.category] = (c[p.category] ?? 0) + 1
    return c
  }, [posts])

  const toggle = (list, setList, value) =>
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value])
  const activeFilters = types.length + regions.length + (favOnly ? 1 : 0) + (hidePast ? 1 : 0)

  const resetFilters = () => {
    setTypes([])
    setRegions([])
    setFavOnly(false)
    setHidePast(false)
    setQuery('')
  }

  const selectTab = (id) => {
    setTab(id)
    track('tab', id)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const onShowPending = () => {
    track('new_posts', null, { count: pending.length })
    showPending()
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const filters = (
    <div className="filters">
      {tab === '입고' && (
        <fieldset>
          <legend>상품 종류</legend>
          <div className="chips">
            {GOODS_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                className={`chip${types.includes(t) ? ' on' : ''}`}
                aria-pressed={types.includes(t)}
                onClick={() => {
                  toggle(types, setTypes, t)
                  track('filter', 'type', { value: t, on: !types.includes(t) })
                }}
              >
                {t}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      <fieldset>
        <legend>
          지역{' '}
          {regions.length > 0 && <span className="legend-note">{regions.join('·')}</span>}
        </legend>
        {/* 시·도로 묶음: 지역이 하나뿐인 시·도는 바로 고르고, 여러 곳이면 펼쳐서 고름 */}
        <div className="chips">
          {regionGroups.map(([sido, list]) => {
            const picked = list.filter((r) => regions.includes(r)).length
            const single = list.length === 1
            const on = single ? picked === 1 : picked === list.length
            return (
              <button
                key={sido}
                type="button"
                className={`chip${on ? ' on' : picked ? ' partial' : ''}${openSido === sido ? ' open' : ''}`}
                aria-pressed={single ? on : undefined}
                aria-expanded={single ? undefined : openSido === sido}
                onClick={() => {
                  if (single) {
                    toggle(regions, setRegions, list[0])
                    track('filter', 'region', { value: list[0], on: !regions.includes(list[0]) })
                  } else setOpenSido(openSido === sido ? null : sido)
                }}
              >
                {sido === ONLINE ? '🛒 ' : ''}{single ? (list[0] === sido ? sido : `${sido} ${list[0]}`) : sido}
                {!single && (picked ? ` ${picked}` : ' ▾')}
              </button>
            )
          })}
        </div>
        {openSido && (
          <div className="chips sub-chips">
            {(() => {
              const list = regionGroups.find(([s]) => s === openSido)?.[1] ?? []
              const all = list.every((r) => regions.includes(r))
              return [
                <button
                  key="all"
                  type="button"
                  className={`chip${all ? ' on' : ''}`}
                  onClick={() => {
                    setRegions(all ? regions.filter((r) => !list.includes(r)) : [...new Set([...regions, ...list])])
                    track('filter', 'region', { value: `${openSido} 전체`, on: !all })
                  }}
                >
                  {openSido} 전체
                </button>,
                ...list.map((r) => (
                  <button
                    key={r}
                    type="button"
                    className={`chip${regions.includes(r) ? ' on' : ''}`}
                    aria-pressed={regions.includes(r)}
                    onClick={() => {
                      toggle(regions, setRegions, r)
                      track('filter', 'region', { value: r, on: !regions.includes(r) })
                    }}
                  >
                    {r}
                  </button>
                )),
              ]
            })()}
          </div>
        )}
      </fieldset>
      <fieldset>
        <legend>즐겨찾기 매장</legend>
        <label className={`check fav-only${favOnly ? ' on' : ''}`}>
          <input
            type="checkbox"
            checked={favOnly}
            onChange={(e) => {
              setFavOnly(e.target.checked)
              track('filter', 'favorite_only', { on: e.target.checked })
            }}
          />
          ★ 즐겨찾기 매장 소식만
        </label>
        {favorites.length > 0 ? (
          <ul className="fav-list">
            {favorites.map((u) => (
              <li key={u}>
                <span>{shopOf.get(u)?.display_name ?? u}</span>
                <button type="button" aria-label={`${shopOf.get(u)?.display_name ?? u} 즐겨찾기 해제`} onClick={() => onToggleFav(u)}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="fav-empty">
            매장 탭이나 매장 정보 창의 ☆를 눌러 자주 가는 매장을 저장해 보세요.{' '}
            <button type="button" className="link-btn" onClick={goShops}>
              매장 보러 가기
            </button>
          </p>
        )}
        <button
          type="button"
          className="add-shop"
          onClick={() => {
            setRequestOpen(true)
            track('request_open')
          }}
        >
          + 매장 추가 신청
        </button>
      </fieldset>
      {(
        <label className="check">
          <input type="checkbox" checked={hidePast} onChange={(e) => {
            setHidePast(e.target.checked)
            track('filter', 'hide_past', { on: e.target.checked })
          }} />
          끝난 행사 숨기기
        </label>
      )}
      {activeFilters > 0 && (
        <button type="button" className="link-btn" onClick={resetFilters}>
          필터 초기화
        </button>
      )}
    </div>
  )

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <h1 className="logo">
            {/* 로고 누르면 처음 화면: 전체 탭 · 검색어 지움 · 맨 위로 (필터는 그대로) */}
            <button
              type="button"
              className="logo-btn"
              onClick={() => {
                setFiltersOpen(false)
                setQuery('')
                selectTab('전체')
              }}
            >
              <img className="logo-icon" src="/favicon-64.png" alt="" width="30" height="30" />
              굿즈레이더
            </button>
          </h1>
          <div className="header-tools">
            <button
              type="button"
              ref={filterBtnRef}
              className={`filter-toggle${filtersOpen ? ' open' : ''}`}
              onClick={() => setFiltersOpen((v) => !v)}
              aria-expanded={filtersOpen}
              aria-label="필터"
              title={live ? '필터 · 실시간 연결됨' : '필터'}
            >
              <SlidersIcon />
            </button>
            <div className="search">
              <input
                type="search"
                placeholder="작품·매장·내용 검색"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="검색"
              />
              <span className="search-icon">
                <SearchIcon />
              </span>
            </div>
          </div>
        </div>
        <nav className="tabs top-tabs" aria-label="분류">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`tab${tab === t.id ? ' on' : ''}`}
              aria-current={tab === t.id ? 'page' : undefined}
              onClick={() => selectTab(t.id)}
            >
              {t.label}
              <span className="count">{t.id === 'map' ? accounts.length : counts[t.id] ?? 0}</span>
            </button>
          ))}
        </nav>
        {filtersOpen && (
          <div className="mobile-filters" ref={filtersRef}>
            {filters}
          </div>
        )}
      </header>
      {/* 필터가 열려 있을 때 목록을 누르면 필터만 닫힘 (글이 열리지 않게 막음) */}
      {filtersOpen && <div className="filters-backdrop" onClick={() => setFiltersOpen(false)} aria-hidden="true" />}

      {pending.length > 0 && (
        <button type="button" className="new-pill" onClick={onShowPending}>
          ↑ 새 소식 {pending.length}개
        </button>
      )}

      <div className="layout">
        <aside className="sidebar" aria-label="필터">
          {filters}
        </aside>

        <main className="main">
          {status === 'loading' && <div className="state">불러오는 중…</div>}
          {status === 'ready' && isMap && (
            <div className="shop-view-switch">
              <div className="segmented" role="group" aria-label="매장 보기 방식">
                {[
                  { id: 'list', label: '목록' },
                  { id: 'map', label: '지도' },
                ].map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    className={shopView === v.id ? 'on' : ''}
                    aria-pressed={shopView === v.id}
                    onClick={() => {
                      setShopView(v.id)
                      track('tab', `shops:${v.id}`)
                    }}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {status === 'ready' && isMap && shopView === 'list' && (
            <ShopList
              accounts={accounts}
              branches={branches}
              posts={posts}
              regions={regions}
              isFav={isFav}
              favCount={favorites.length}
              onToggleFav={onToggleFav}
              query={query}
              now={now}
              onShopOpen={(username) => {
                setShopInfo({ username, branches: [] })
                track('shop_open', username, { from: 'list' })
              }}
            />
          )}
          {status === 'ready' && isMap && shopView === 'map' && (
            <MapView
              branches={mapBranches}
              shopOf={shopOf}
              postCountOf={postCountOf}
              now={now}
              onShopOpen={(username, focus) => {
                setShopInfo({ username, branches: focus })
                track('shop_open', username, { from: 'map' })
              }}
            />
          )}
          {status === 'error' && (
            <div className="state">
              <p>소식을 불러오지 못했습니다.</p>
              <button type="button" className="btn" onClick={reload}>
                다시 시도
              </button>
            </div>
          )}
          {listReady && visible.length === 0 && (
            <div className="state">
              <p>
                {favOnly && favorites.length === 0
                  ? '즐겨찾기한 매장이 없어요. 매장 탭에서 ☆를 눌러 자주 가는 매장을 저장해 보세요.'
                  : '조건에 맞는 소식이 없습니다.'}
              </p>
              {favOnly && favorites.length === 0 && (
                <button type="button" className="btn" onClick={goShops}>
                  매장 보러 가기
                </button>
              )}
              {(activeFilters > 0 || query) && (
                <button type="button" className="btn" onClick={resetFilters}>
                  필터 초기화
                </button>
              )}
            </div>
          )}
          {listReady && (
            <div className="toolbar">
              {/* 필터로 일부만 보일 때는 "보이는 글 / 이 탭 전체 글" */}
              <span className="result-count">
                {visible.length === (counts[tab] ?? 0) ? (
                  `${visible.length}개`
                ) : (
                  <>
                    <b>{visible.length}</b> / {counts[tab] ?? 0}개
                  </>
                )}
              </span>
              <div className="segmented" role="group" aria-label="정렬">
                {SORTS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={sortMode === s.id ? 'on' : ''}
                    aria-pressed={sortMode === s.id}
                    onClick={() => {
                      setSortMode(s.id)
                      track('sort', s.id)
                    }}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {listReady && visible.length > 0 && (
            <div className="grid">
              {page.map(({ post: p, group }, i) => (
                <Fragment key={p.code}>
                  {group && group !== page[i - 1]?.group && (
                    <h2 className={`section-title section-${group}`}>
                      {GROUPS[group]}
                      <span className="count">{groupCount[group]}</span>
                      {group === 'past' && !onlyPast && (
                        <button type="button" className="section-toggle" onClick={() => setPastOpen(false)}>
                          접기
                        </button>
                      )}
                    </h2>
                  )}
                  <PostCard
                    post={p}
                    now={now}
                    shopName={shopOf.get(p.account_username)?.display_name ?? p.account_username}
                    showBranch={(branchCount.get(p.account_username) ?? 0) > 1}
                    fav={isFav(p.account_username)}
                    isNew={now - new Date(p.first_seen_at).getTime() < NEW_MS && now - new Date(p.posted_at).getTime() < NEW_MS}
                    onOpen={() => {
                      setDetail(p)
                      track('more', p.code, { shop: p.account_username })
                    }}
                    onShopClick={() => {
                      setShopInfo({ username: p.account_username, branches: p.branches })
                      track('shop_open', p.account_username, { from: 'card' })
                    }}
                  />
                </Fragment>
              ))}
            </div>
          )}

          {/* 30개씩: 목록 끝에 닿으면 자동으로 다음 30개 (안 되면 버튼으로) */}
          {listReady && shown < list.length && (
            <div ref={moreRef} className="load-more">
              <button type="button" className="btn" onClick={() => setShown((n) => n + PAGE_SIZE)}>
                더 보기 ({list.length - shown}개 남음)
              </button>
            </div>
          )}

          {/* 지난 소식: 처음에는 접어 두고, 위 목록을 다 본 뒤에 펼치기 버튼 */}
          {listReady && pastHidden && shown >= list.length && (
            <button type="button" className="past-fold" onClick={() => setPastOpen(true)}>
              <span>
                {GROUPS.past} <span className="count">{groupCount.past}</span>
              </span>
              <span className="past-fold-action">
                펼치기
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </span>
            </button>
          )}

          <footer className="site-footer">
            <button type="button" className="feedback-btn" onClick={() => setFeedbackOpen(true)}>
              💬 의견 보내기
            </button>
            <p>
              <b>출처</b> · 굿즈레이더는 각 매장 인스타그램의 공개 게시물을 모아 보여줍니다. 게시물의 글과 사진에 대한 권리는
              해당 매장에 있으며, 각 소식의 <b>인스타그램</b> 버튼으로 원문을 확인할 수 있습니다. 정확한 내용은 매장 게시물을 확인해
              주세요.
            </p>
            <p>
              <b>게시 중단 요청</b> · 매장 운영자분께서 게시물 노출을 원하지 않으시면 매장 인스타그램 아이디와 함께{' '}
              <a href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('[굿즈레이더] 게시 중단 요청')}`}>{CONTACT_EMAIL}</a>
              로 메일을 보내 주세요. 확인 후 해당 매장의 게시물을 내리겠습니다.
            </p>
            <p className="muted-line">서비스 개선을 위해 개인을 알아볼 수 없는 방문·이용 통계를 수집합니다.</p>
          </footer>
        </main>
      </div>

      <nav className="tabs bottom-tabs" aria-label="분류">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`tab${tab === t.id ? ' on' : ''}`}
            aria-current={tab === t.id ? 'page' : undefined}
            onClick={() => selectTab(t.id)}
          >
            <span className="tab-icon">
              <t.Icon />
            </span>
            {t.label}
          </button>
        ))}
      </nav>

      {showTop && (
        <button
          type="button"
          className="to-top"
          aria-label="맨 위로"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="18 15 12 9 6 15" />
          </svg>
        </button>
      )}

      {!isMap && !filtersOpen && <InstallPrompt />}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}

      {requestOpen && <RequestShop accounts={accounts} onClose={() => setRequestOpen(false)} />}
      {feedbackOpen && (
        <Feedback
          context={[TABS.find((t) => t.id === tab)?.label, detail && `글 ${detail.code}`].filter(Boolean).join(' · ')}
          onClose={() => setFeedbackOpen(false)}
        />
      )}
      {detail && (
        <PostDetail
          post={posts.find((x) => x.code === detail.code) ?? detail}
          shop={shopOf.get(detail.account_username)}
          showBranch={(branchCount.get(detail.account_username) ?? 0) > 1}
          fav={isFav(detail.account_username)}
          now={now}
          onClose={() => setDetail(null)}
          onShopOpen={() => {
            // 상세 창 위에 매장 정보 창을 겹쳐 엶 (닫으면 상세 창으로 돌아옴)
            setShopInfo({ username: detail.account_username, branches: detail.branches })
            track('shop_open', detail.account_username, { from: 'detail' })
          }}
        />
      )}

      {shopInfo && shopOf.get(shopInfo.username) && (
        <ShopInfo
          account={shopOf.get(shopInfo.username)}
          branches={branches.filter((b) => b.account_username === shopInfo.username)}
          posts={posts.filter((p) => p.account_username === shopInfo.username)}
          focusBranches={shopInfo.branches}
          now={now}
          fav={isFav(shopInfo.username)}
          onToggleFav={() => onToggleFav(shopInfo.username)}
          onClose={() => setShopInfo(null)}
        />
      )}
    </div>
  )
}
