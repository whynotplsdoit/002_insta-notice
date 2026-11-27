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
import { BoxIcon, MapPinIcon, MegaphoneIcon, RadarIcon, SearchIcon, SlidersIcon } from './icons.jsx'
import MapView from './MapView.jsx'
import ShopList from './ShopList.jsx'
import { useFavorites } from './favorites.jsx'
import { groupRegions, ONLINE, shopTypeOf, shopTypeRank } from './regions.js'
import { GROUPS, scheduleOf, sortByPosted, sortBySchedule } from './sort.js'

const SORTS = [
  { id: 'schedule', label: '일정순' },
  { id: 'posted', label: '최신순' },
]

const TABS = [
  { id: '전체', label: '전체', Icon: RadarIcon },
  { id: '입고', label: '입고', Icon: BoxIcon },
  { id: '행사', label: '행사', Icon: MegaphoneIcon },
  { id: 'map', label: '매장', Icon: MapPinIcon }, // 글 목록 대신 매장 [목록 | 지도] (예전 저장값과 맞추려고 id 는 map 유지)
]
const GOODS_TYPES = ['쿠지', '가챠', '피규어', '굿즈']
// 글 분류(DB category) → 메뉴. 행사 = 콜라보·팝업 + 이벤트·안내
// TODO(배포 때): 크롤러가 '이벤트·안내'를 '행사'와 '안내'로 나누면 '안내'는 메뉴 없이 전체에서만 보이게
const TAB_OF_CATEGORY = { 입고: '입고', '콜라보·팝업': '행사', '이벤트·안내': '행사' }
const tabOf = (category) => TAB_OF_CATEGORY[category] ?? category
const STORAGE_KEY = 'goods-feed:filters:v2'
const SEEN_KEY = 'goods-radar:tab-seen' // 분류별로 마지막에 본 오늘 글의 수집 시각 (메뉴 핑크 점)
const CONTACT_EMAIL = 'whynot.plsdoit@gmail.com' // 게시 중단 요청 받는 메일
const PAGE_SIZE = 30 // 한 번에 보여줄 글 수
// "오늘" = 한국 날짜 기준 (메뉴 핑크 점)
const DAY_MS = 24 * 3600_000
const KST_MS = 9 * 3600_000
const todayStartKST = (ms) => Math.floor((ms + KST_MS) / DAY_MS) * DAY_MS - KST_MS

// 탭·필터는 이 브라우저에만 기억 (저장이 막혀 있어도 정상 동작)
function loadSaved() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {}
  } catch {
    return {}
  }
}

// 필터 묶음 제목
function FilterLegend({ label }) {
  return <legend className="filter-legend">{label}</legend>
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
  // 예전 메뉴(콜라보·팝업, 이벤트·안내)를 보던 사람은 행사로
  const [tab, setTab] = useState(() => (TABS.some((t) => t.id === tabOf(saved.tab)) ? tabOf(saved.tab) : '전체'))
  const [types, setTypes] = useState(saved.types ?? [])
  const [regions, setRegions] = useState(saved.regions ?? [])
  // 즐겨찾기 매장 (이 브라우저에만 저장) + "즐겨찾기 매장 소식만" 켜기
  // 예전 필터에서 매장을 골라 둔 사람은 그 매장이 즐겨찾기로 옮겨지고 켜진 상태로 시작
  const { favorites, isFav, toggleFav } = useFavorites()
  const [favOnly, setFavOnly] = useState(saved.favOnly ?? (Array.isArray(saved.shops) && saved.shops.length > 0))
  const [openSido, setOpenSido] = useState(null) // 지역 필터에서 펼친 시·도
  const [shopKinds, setShopKinds] = useState([]) // 매장 종류 필터 (여러 개, 비어 있으면 전체)
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
    setToast(on ? (first ? '단골 매장에 추가했어요 · 이 브라우저에 저장돼요' : '단골 매장에 추가했어요') : '단골 매장을 해제했어요')
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

  // 필터 규칙: 같은 묶음 안에서는 여러 개 중 하나라도(또는), 묶음끼리는 모두 만족(그리고). 아무것도 안 고르면 전체
  // 매장 종류 (모든 메뉴 공통)
  const shopTypes = useMemo(() => [...new Set(accounts.map(shopTypeOf))].sort((a, b) => shopTypeRank(a) - shopTypeRank(b)), [accounts])
  const shopKindOk = (username) => !shopKinds.length || shopKinds.includes(shopTypeOf(shopOf.get(username)))
  // 매장이 다루는 상품 종류 = 그 매장 글에 붙은 상품 종류 (매장 탭·지도에서 상품 종류 필터에 씀)
  const goodsOfShop = useMemo(() => {
    const m = new Map()
    for (const p of posts) {
      if (!m.has(p.account_username)) m.set(p.account_username, new Set())
      for (const t of p.goods_type) m.get(p.account_username).add(t)
    }
    return m
  }, [posts])
  const shopGoodsOk = (username) => !types.length || types.some((t) => goodsOfShop.get(username)?.has(t))

  const postRegions = (p) => {
    const list = p.branches.map((name) => regionOf.get(`${p.account_username}/${name}`)).filter(Boolean)
    return list.length ? list : branches.filter((b) => b.account_username === p.account_username).map((b) => b.region)
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/\s+/g, '')
    const now = Date.now()
    return posts.filter((p) => {
      if (tab !== '전체' && tabOf(p.category) !== tab) return false
      // 상품 종류: 모든 메뉴 (지금은 입고 글에만 상품 종류가 붙어서 행사에서 고르면 비어 있음 — 배포 때 크롤러 수정)
      if (types.length && !p.goods_type.some((t) => types.includes(t))) return false
      if (favOnly && !favorites.includes(p.account_username)) return false
      if (regions.length && !postRegions(p).some((r) => regions.includes(r))) return false
      if (!shopKindOk(p.account_username)) return false
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
  }, [posts, tab, types, regions, shopKinds, favOnly, favorites, query, hidePast, shopOf, regionOf])

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
        (b) =>
          (regions.length === 0 || regions.includes(b.region)) &&
          shopKindOk(b.account_username) &&
          shopGoodsOk(b.account_username) &&
          (!favOnly || favorites.includes(b.account_username)),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [branches, regions, shopKinds, types, goodsOfShop, favOnly, favorites, shopOf],
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
    for (const p of posts) c[tabOf(p.category)] = (c[tabOf(p.category)] ?? 0) + 1
    return c
  }, [posts])

  // 메뉴 핑크 점: 그 분류에 오늘(한국 날짜) 올라온 글 중 안 본 게 있으면 표시
  // 그 메뉴를 보면 본 것으로 침(보는 동안 들어온 글 포함) / "전체"를 보면 모두 본 것 / 전체 점 = 어느 분류든 안 본 오늘 글
  // 본 뒤에 오늘 글이 또 올라오면 다시 뜨고, 자정이 지나면 어제 글은 빠져서 사라짐
  const todayStart = todayStartKST(now)
  const latestByCat = useMemo(() => {
    const m = {}
    for (const p of posts) {
      if (Date.parse(p.posted_at) < todayStart) continue
      const t = Date.parse(p.first_seen_at) || 0
      const k = tabOf(p.category)
      if (t > (m[k] ?? 0)) m[k] = t
    }
    return m
  }, [posts, todayStart])
  const [seen, setSeen] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(SEEN_KEY))
    } catch {
      return null
    }
  })
  useEffect(() => {
    if (status !== 'ready') return
    setSeen((prev) => {
      const next = { ...(prev ?? {}) }
      let changed = !prev
      const mark = (c) => {
        if ((latestByCat[c] ?? 0) > (next[c] ?? 0)) {
          next[c] = latestByCat[c]
          changed = true
        }
      }
      if (tab === '전체') Object.keys(latestByCat).forEach(mark)
      else if (tab !== 'map') mark(tab)
      if (!changed) return prev
      try {
        localStorage.setItem(SEEN_KEY, JSON.stringify(next))
      } catch {
        /* 저장 못 해도 화면은 그대로 */
      }
      return next
    })
  }, [status, latestByCat, tab])
  const hasNew = useMemo(() => {
    const r = {}
    for (const [c, t] of Object.entries(latestByCat)) {
      if (t > (seen?.[c] ?? 0)) r[c] = r['전체'] = true
    }
    // "새 소식 N개" 버튼 뒤에서 기다리는 글(아직 목록에 안 넣은 글)은 못 본 글이라 무조건 점
    for (const p of pending) {
      if (Date.parse(p.posted_at) >= todayStart) r[tabOf(p.category)] = r['전체'] = true
    }
    return r
  }, [seen, latestByCat, pending, todayStart])

  const toggle = (list, setList, value) =>
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value])
  const activeFilters = types.length + regions.length + shopKinds.length + (favOnly ? 1 : 0) + (hidePast ? 1 : 0)

  const resetFilters = () => {
    setTypes([])
    setRegions([])
    setOpenSido(null)
    setShopKinds([])
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
      {/* 지역: 모든 메뉴 공통이라 맨 위 고정 */}
      <fieldset>
        <FilterLegend
          label="지역"
          count={regions.length}
          onClear={() => {
            setRegions([])
            setOpenSido(null)
            track('filter', 'region_clear')
          }}
        />
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
                {sido === ONLINE ? '🛒 ' : ''}{sido /* 매장 탭처럼 시·도 이름만 */}
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
      {/* 매장 종류: 모든 메뉴 공통, 여러 개 선택 */}
      <fieldset>
        <FilterLegend
          label="매장 종류"
          count={shopKinds.length}
          onClear={() => {
            setShopKinds([])
            track('filter', 'shop_type_clear')
          }}
        />
        <div className="chips">
          {shopTypes.map((t) => (
            <button
              key={t}
              type="button"
              className={`chip${shopKinds.includes(t) ? ' on' : ''}`}
              aria-pressed={shopKinds.includes(t)}
              onClick={() => {
                toggle(shopKinds, setShopKinds, t)
                track('filter', 'shop_type', { value: t, on: !shopKinds.includes(t) })
              }}
            >
              {t}
            </button>
          ))}
        </div>
      </fieldset>
      {/* 상품 종류: 모든 메뉴 공통, 여러 개 선택 (매장 탭에서는 그 상품을 다루는 매장) */}
      {(
        <fieldset>
          <FilterLegend
            label="상품 종류"
            count={types.length}
            onClear={() => {
              setTypes([])
              track('filter', 'type_clear')
            }}
          />
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
      {activeFilters > 0 && (
        <button type="button" className="link-btn" onClick={resetFilters}>
          필터 초기화
        </button>
      )}
      {/* 켜고 끄는 보기 설정: 필터 맨 아래 고정 */}
      <div className="filter-toggles">
        {[
          { id: 'favorite_only', label: '단골 매장 소식만 보기', on: favOnly, set: setFavOnly },
          { id: 'hide_past', label: '끝난 행사 숨기기', on: hidePast, set: setHidePast },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            role="switch"
            aria-checked={t.on}
            className={`toggle-row${t.on ? ' on' : ''}`}
            onClick={() => {
              t.set(!t.on)
              track('filter', t.id, { on: !t.on })
            }}
          >
            <span>{t.label}</span>
            <span className="switch" aria-hidden="true" />
          </button>
        ))}
      </div>
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
              <img className="logo-icon" src="/favicon-64.png" alt="" width="36" height="36" />
              <span className="logo-text">굿즈레이더</span>
            </button>
          </h1>
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
                {hasNew[t.id] && <span className="tab-dot" aria-label="새 글" />}
              </button>
            ))}
          </nav>
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
            <div className={`search${query ? ' has-value' : ''}`}>
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
            </div>
          )}
          {status === 'ready' && isMap && shopView === 'list' && (
            <ShopList
              accounts={accounts}
              branches={branches}
              posts={posts}
              regions={regions}
              shopKinds={shopKinds}
              goodsTypes={types}
              goodsOfShop={goodsOfShop}
              favOnly={favOnly}
              onClearFilters={resetFilters}
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
                  ? '단골 매장이 없어요. 매장 탭에서 하트를 눌러 단골 매장을 추가해 보세요.'
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
              {hasNew[t.id] && <span className="tab-dot" aria-label="새 글" />}
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
