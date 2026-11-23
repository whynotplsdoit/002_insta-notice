import { Fragment, useEffect, useMemo, useState } from 'react'
import './App.css'
import { configured } from './supabase.js'
import { usePosts } from './usePosts.js'
import PostCard from './PostCard.jsx'
import RequestShop from './RequestShop.jsx'
import { BoxIcon, MegaphoneIcon, RadarIcon, SearchIcon, SlidersIcon, StoreIcon } from './icons.jsx'
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
]
const GOODS_TYPES = ['쿠지', '가챠', '피규어', '굿즈']
const STORAGE_KEY = 'goods-feed:filters:v2'
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
  // 고른 매장: null 이면 전체, 배열이면 그 매장만 (빈 배열 = 하나도 안 고름)
  const [shops, setShops] = useState(Array.isArray(saved.shops) && saved.shops.length ? saved.shops : null)
  const [query, setQuery] = useState('')
  const [hidePast, setHidePast] = useState(saved.hidePast ?? false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [requestOpen, setRequestOpen] = useState(false)
  const [sortMode, setSortMode] = useState(saved.sortMode === 'posted' ? 'posted' : 'schedule')
  const [now, setNow] = useState(Date.now())

  // 자정이 지나도 "오늘" 기준이 맞도록 1분마다 현재 시각 갱신
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ tab, types, regions, shops, hidePast, sortMode }))
    } catch {
      // 저장 못 해도 괜찮음
    }
  }, [tab, types, regions, shops, hidePast, sortMode])

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
  const allRegions = useMemo(() => [...new Set(branches.map((b) => b.region).filter(Boolean))], [branches])
  const sortedShops = useMemo(
    () => accounts.slice().sort((a, b) => a.display_name.localeCompare(b.display_name, 'ko')),
    [accounts],
  )
  const regionsOfShop = (username) =>
    [...new Set(branches.filter((b) => b.account_username === username).map((b) => b.region))].join('·')
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
      if (shops !== null && !shops.includes(p.account_username)) return false
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
  }, [posts, tab, types, regions, shops, query, hidePast, shopOf, regionOf])

  const sorted = useMemo(
    () => (sortMode === 'posted' ? sortByPosted(visible) : sortBySchedule(visible, now)),
    [visible, sortMode, now],
  )

  const counts = useMemo(() => {
    const c = { 전체: posts.length }
    for (const p of posts) c[p.category] = (c[p.category] ?? 0) + 1
    return c
  }, [posts])

  const toggle = (list, setList, value) =>
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value])
  const activeFilters = types.length + regions.length + (shops !== null ? 1 : 0) + (hidePast ? 1 : 0)

  // 매장 하나 켜고 끄기: 모두 켜지면 다시 "전체"로
  const toggleShop = (username) => {
    const all = sortedShops.map((a) => a.username)
    const current = shops ?? all
    const next = current.includes(username) ? current.filter((u) => u !== username) : [...current, username]
    setShops(next.length === all.length ? null : next)
  }

  const resetFilters = () => {
    setTypes([])
    setRegions([])
    setShops(null)
    setHidePast(false)
    setQuery('')
  }

  const selectTab = (id) => {
    setTab(id)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const onShowPending = () => {
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
                onClick={() => toggle(types, setTypes, t)}
              >
                {t}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      <fieldset>
        <legend>지역</legend>
        <div className="chips">
          {allRegions.map((r) => (
            <button
              key={r}
              type="button"
              className={`chip${regions.includes(r) ? ' on' : ''}`}
              aria-pressed={regions.includes(r)}
              onClick={() => toggle(regions, setRegions, r)}
            >
              {r}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>
          매장{' '}
          <span className="legend-note">
            {shops === null ? '전체' : `${shops.length}/${sortedShops.length}곳`}
          </span>
        </legend>
        <ul className="shop-list">
          <li>
            <label className={`shop-item shop-all${shops === null ? ' on' : ''}`}>
              <input
                type="checkbox"
                checked={shops === null}
                ref={(el) => el && (el.indeterminate = shops !== null && shops.length > 0)}
                onChange={() => setShops(shops === null ? [] : null)}
              />
              <span className="shop-info">
                <span className="shop-name">전체 매장</span>
              </span>
              <span className="shop-count">{posts.length}</span>
            </label>
          </li>
          {sortedShops.map((a) => {
            const on = shops === null || shops.includes(a.username)
            return (
              <li key={a.username}>
                <label className={`shop-item${on ? ' on' : ''}`}>
                  <input type="checkbox" checked={on} onChange={() => toggleShop(a.username)} />
                  <span className="shop-info">
                    <span className="shop-name">{a.display_name}</span>
                    <span className="shop-region">{regionsOfShop(a.username)}</span>
                  </span>
                  <span className="shop-count">{postCountOf.get(a.username) ?? 0}</span>
                </label>
              </li>
            )
          })}
        </ul>
        <button type="button" className="add-shop" onClick={() => setRequestOpen(true)}>
          + 매장 추가 신청
        </button>
      </fieldset>
      {(
        <label className="check">
          <input type="checkbox" checked={hidePast} onChange={(e) => setHidePast(e.target.checked)} />
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
            <img className="logo-icon" src="/favicon-64.png" alt="" width="30" height="30" />
            굿즈레이더
          </h1>
          <div className="header-tools">
            <button
              type="button"
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
              <span className="count">{counts[t.id] ?? 0}</span>
            </button>
          ))}
        </nav>
        {filtersOpen && <div className="mobile-filters">{filters}</div>}
      </header>

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
          {status === 'error' && (
            <div className="state">
              <p>소식을 불러오지 못했습니다.</p>
              <button type="button" className="btn" onClick={reload}>
                다시 시도
              </button>
            </div>
          )}
          {status === 'ready' && visible.length === 0 && (
            <div className="state">
              <p>{shops?.length === 0 ? '매장을 하나 이상 선택하세요.' : '조건에 맞는 소식이 없습니다.'}</p>
              {(activeFilters > 0 || query) && (
                <button type="button" className="btn" onClick={resetFilters}>
                  필터 초기화
                </button>
              )}
            </div>
          )}
          {status === 'ready' && (
            <div className="toolbar">
              <span className="result-count">{visible.length}개</span>
              <div className="segmented" role="group" aria-label="정렬">
                {SORTS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={sortMode === s.id ? 'on' : ''}
                    aria-pressed={sortMode === s.id}
                    onClick={() => setSortMode(s.id)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {status === 'ready' && visible.length > 0 && (
            <div className="grid">
              {sorted.map(({ post: p, group }, i) => (
                <Fragment key={p.code}>
                  {group && group !== sorted[i - 1]?.group && (
                    <h2 className={`section-title section-${group}`}>
                      {GROUPS[group]}
                      <span className="count">{sorted.filter((x) => x.group === group).length}</span>
                    </h2>
                  )}
                  <PostCard
                    post={p}
                    now={now}
                    shopName={shopOf.get(p.account_username)?.display_name ?? p.account_username}
                    showBranch={(branchCount.get(p.account_username) ?? 0) > 1}
                    isNew={now - new Date(p.first_seen_at).getTime() < NEW_MS && now - new Date(p.posted_at).getTime() < NEW_MS}
                  />
                </Fragment>
              ))}
            </div>
          )}
          <p className="footnote">
            인스타그램 공개 게시물을 모아 보여줍니다. 정확한 내용은 각 매장 게시물을 확인하세요.
          </p>
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

      {requestOpen && <RequestShop accounts={accounts} onClose={() => setRequestOpen(false)} />}
    </div>
  )
}
