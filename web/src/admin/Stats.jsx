// 통계: 사용 행동 기록(events)을 기간별로 모아 보여줌
// 방문자·방문 수, 일별 방문자, 기기·유입 경로, 매장별 관심도, 인스타 클릭 많은 글, 인기 검색어, 기능 사용
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabase.js'
import { titleOf } from '../format.js'

const PERIODS = [
  { days: 1, label: '오늘' },
  { days: 7, label: '7일' },
  { days: 30, label: '30일' },
  { days: 90, label: '90일' },
]
const PAGE = 1000 // Supabase 한 번에 최대 1000줄
const MAX_ROWS = 50000
const DAY = 86400000
const KST = 9 * 3600000

const kstDay = (iso) => new Date(new Date(iso).getTime() + KST).toISOString().slice(0, 10)
const count = (arr, keyFn) => {
  const m = new Map()
  for (const x of arr) {
    const k = keyFn(x)
    if (k == null || k === '') continue
    m.set(k, (m.get(k) ?? 0) + 1)
  }
  return [...m].sort((a, b) => b[1] - a[1])
}
const uniq = (arr, keyFn) => new Set(arr.map(keyFn)).size

const FEATURE_LABELS = {
  tab: '분류 탭 바꾸기',
  sort: '정렬 바꾸기',
  filter: '필터 사용',
  search: '검색',
  more: '글 상세 보기',
  new_posts: '새 소식 버튼',
  shop_open: '매장 정보 창 열기',
  shop_only: '이 매장 소식만 보기',
  map_click: '네이버 지도',
  phone_click: '전화 걸기',
  insta_click: '인스타그램 이동',
  request_open: '매장 추가 신청 창',
  request_submit: '매장 추가 신청 완료',
}
const DEVICE_LABELS = { mobile: '휴대폰', tablet: '태블릿', pc: 'PC' }

export default function Stats() {
  const [days, setDays] = useState(7)
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [names, setNames] = useState(new Map())
  const [titles, setTitles] = useState(new Map())

  const load = useCallback(async () => {
    setRows(null)
    setError('')
    const since = new Date(Date.now() - days * DAY).toISOString()
    const all = []
    for (let from = 0; from < MAX_ROWS; from += PAGE) {
      const { data, error: err } = await supabase
        .from('events')
        .select('created_at, visitor_id, session_id, type, target, meta, device')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .range(from, from + PAGE - 1)
      if (err) {
        setError(err.message)
        setRows([])
        return
      }
      all.push(...data)
      if (data.length < PAGE) break
    }
    setRows(all)
  }, [days])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    supabase
      .from('accounts')
      .select('username, display_name')
      .then(({ data }) => setNames(new Map((data ?? []).map((a) => [a.username, a.display_name]))))
  }, [])

  // 즐겨찾기 기록 (기간과 상관없이 보관 중인 전체 180일): 방문자마다 매장별 마지막 상태(추가/해제)
  const [favRows, setFavRows] = useState(null)
  useEffect(() => {
    ;(async () => {
      const all = []
      for (let from = 0; from < MAX_ROWS; from += PAGE) {
        const { data, error: err } = await supabase
          .from('events')
          .select('created_at, visitor_id, meta')
          .eq('type', 'filter')
          .eq('target', 'favorite')
          .order('created_at', { ascending: true })
          .range(from, from + PAGE - 1)
        if (err) return setFavRows([])
        all.push(...data)
        if (data.length < PAGE) break
      }
      setFavRows(all)
    })()
  }, [])

  const favs = useMemo(() => {
    if (!favRows) return null
    const since = Date.now() - days * DAY
    const last = new Map() // "방문자|매장" → 마지막 상태
    const shop = new Map() // 매장 → { now, added, removed } (added/removed 는 고른 기간 안)
    const get = (u) => shop.get(u) ?? shop.set(u, { now: 0, added: 0, removed: 0 }).get(u)
    for (const r of favRows) {
      const u = r.meta?.value
      if (!u) continue
      last.set(`${r.visitor_id}|${u}`, r.meta?.on !== false)
      if (new Date(r.created_at).getTime() >= since) get(u)[r.meta?.on === false ? 'removed' : 'added']++
    }
    for (const [key, on] of last) if (on) get(key.split('|')[1]).now++
    return [...shop]
      .map(([u, o]) => ({ u, ...o }))
      .filter((r) => r.now || r.added || r.removed)
      .sort((a, b) => b.now - a.now || b.added - a.added)
  }, [favRows, days])

  const s = useMemo(() => {
    if (!rows) return null
    const visits = rows.filter((r) => r.type === 'visit')
    const byType = (t) => rows.filter((r) => r.type === t)

    // 일별 방문자 (고유 방문자 수)
    const dayMap = new Map()
    for (let i = days - 1; i >= 0; i--) dayMap.set(kstDay(new Date(Date.now() - i * DAY).toISOString()), new Set())
    for (const r of rows) dayMap.get(kstDay(r.created_at))?.add(r.visitor_id)
    const daily = [...dayMap].map(([d, set]) => ({ day: d, value: set.size }))

    // 매장별 관심도
    const shopScore = new Map()
    const add = (u, k) => {
      if (!u) return
      const o = shopScore.get(u) ?? { open: 0, insta: 0, map: 0, phone: 0 }
      o[k]++
      shopScore.set(u, o)
    }
    for (const r of byType('shop_open')) add(r.target, 'open')
    for (const r of byType('insta_click')) add(r.meta?.shop, 'insta')
    for (const r of byType('map_click')) add(r.target, 'map')
    for (const r of byType('phone_click')) add(r.target, 'phone')
    const shops = [...shopScore]
      .map(([u, o]) => ({ u, ...o, total: o.open + o.insta + o.map + o.phone }))
      .sort((a, b) => b.total - a.total)

    return {
      visitors: uniq(rows, (r) => r.visitor_id),
      sessions: uniq(visits, (r) => r.session_id),
      events: rows.length,
      daily,
      devices: count(visits, (r) => DEVICE_LABELS[r.device] ?? r.device),
      refs: count(visits, (r) => r.meta?.ref ?? '직접 방문·북마크'),
      shops,
      posts: count(byType('insta_click'), (r) => r.target).slice(0, 10),
      searches: count(byType('search'), (r) => r.target.toLowerCase()).slice(0, 15),
      features: count(rows.filter((r) => r.type !== 'visit'), (r) => r.type),
      // 즐겨찾기 추가·해제는 위 "즐겨찾기 인기 매장"에서 따로 봄
      filters: count(byType('filter').filter((r) => r.meta?.on !== false && r.target !== 'favorite'), (r) =>
        r.target === 'hide_past'
          ? '끝난 행사 숨기기'
          : r.target === 'favorite_only'
            ? '즐겨찾기 매장 소식만'
            : `${{ type: '종류', region: '지역', shop: '매장', shop_type: '매장 탭 종류', shop_area: '매장 탭 지역', shop_section: '매장 탭 펼치기' }[r.target] ?? r.target}: ${r.meta?.value === 'all' ? '전체' : names.get(r.meta?.value) ?? r.meta?.value}`,
      ).slice(0, 10),
      tabs: count(byType('tab'), (r) => r.target),
    }
  }, [rows, days, names])

  // 인스타 클릭 많은 글 제목 불러오기
  useEffect(() => {
    const codes = s?.posts.map(([c]) => c) ?? []
    if (!codes.length) return
    supabase
      .from('posts')
      .select('code, caption, account_username')
      .in('code', codes)
      .then(({ data }) => setTitles(new Map((data ?? []).map((p) => [p.code, p]))))
  }, [s])

  return (
    <div className="a-stack">
      <div className="a-h2-row">
        <h2 className="a-h2">사용 통계</h2>
        <div className="a-seg" role="group" aria-label="기간">
          {PERIODS.map((p) => (
            <button key={p.days} className={days === p.days ? 'on' : ''} onClick={() => setDays(p.days)}>
              {p.label}
            </button>
          ))}
        </div>
        <button className="a-btn a-small" onClick={load}>
          새로고침
        </button>
      </div>

      {error && (
        <div className="a-alert warn">
          통계를 불러오지 못했습니다: {error}
          <br />
          supabase/07-events.sql 을 실행했는지 확인하세요.
        </div>
      )}
      {!s && !error && <p className="a-empty">불러오는 중…</p>}

      {s && (
        <>
          <div className="a-stats">
            <Stat label="방문자" value={s.visitors} note="브라우저 기준 고유 방문자" />
            <Stat label="방문" value={s.sessions} note="사이트를 연 횟수" />
            <Stat label="기록된 행동" value={s.events} note="클릭·검색·필터 등" />
          </div>

          {days > 1 && <DailyChart data={s.daily} />}

          <div className="a-two">
            <RankCard title="기기" rows={s.devices} />
            <RankCard title="유입 경로" rows={s.refs} />
          </div>

          <section className="a-card a-pad">
            <h3 className="a-h3">매장별 관심도</h3>
            {s.shops.length === 0 ? (
              <p className="a-empty">기록이 없습니다.</p>
            ) : (
              <table className="a-table">
                <thead>
                  <tr>
                    <th>매장</th>
                    <th>정보 창</th>
                    <th>인스타 이동</th>
                    <th>지도</th>
                    <th>전화</th>
                    <th>합계</th>
                  </tr>
                </thead>
                <tbody>
                  {s.shops.map((r) => (
                    <tr key={r.u}>
                      <td>{names.get(r.u) ?? r.u}</td>
                      <td>{r.open}</td>
                      <td>{r.insta}</td>
                      <td>{r.map}</td>
                      <td>{r.phone}</td>
                      <td className="a-strong">{r.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="a-card a-pad">
            <h3 className="a-h3">즐겨찾기 인기 매장</h3>
            {!favs ? (
              <p className="a-empty">불러오는 중…</p>
            ) : favs.length === 0 ? (
              <p className="a-empty">아직 즐겨찾기 기록이 없습니다.</p>
            ) : (
              <table className="a-table">
                <thead>
                  <tr>
                    <th>매장</th>
                    <th>지금 즐겨찾기</th>
                    <th>추가 ({PERIODS.find((p) => p.days === days)?.label})</th>
                    <th>해제 ({PERIODS.find((p) => p.days === days)?.label})</th>
                  </tr>
                </thead>
                <tbody>
                  {favs.map((r) => (
                    <tr key={r.u}>
                      <td>{names.get(r.u) ?? r.u}</td>
                      <td className="a-strong">{r.now}명</td>
                      <td>{r.added}</td>
                      <td>{r.removed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="a-muted a-small-text">
              "지금 즐겨찾기"는 브라우저마다 마지막으로 누른 상태(추가/해제)로 센 사람 수입니다. 예전 필터에서 옮겨진 즐겨찾기와 브라우저 기록을
              지운 경우는 셀 수 없어서 실제보다 조금 다를 수 있습니다.
            </p>
          </section>

          <section className="a-card a-pad">
            <h3 className="a-h3">인스타 이동이 많은 글</h3>
            {s.posts.length === 0 ? (
              <p className="a-empty">기록이 없습니다.</p>
            ) : (
              <ol className="a-rank">
                {s.posts.map(([code, n]) => {
                  const p = titles.get(code)
                  return (
                    <li key={code}>
                      <a href={`https://www.instagram.com/p/${code}/`} target="_blank" rel="noopener noreferrer">
                        {p ? `${names.get(p.account_username) ?? ''} · ${titleOf(p.caption) || '(본문 없음)'}` : `${code} (삭제된 글)`}
                      </a>
                      <span className="a-num">{n}</span>
                    </li>
                  )
                })}
              </ol>
            )}
          </section>

          <div className="a-two">
            <RankCard title="인기 검색어" rows={s.searches} />
            <RankCard title="많이 쓴 필터" rows={s.filters} />
          </div>
          <div className="a-two">
            <RankCard title="많이 본 탭" rows={s.tabs} />
            <RankCard title="기능 사용" rows={s.features.map(([k, v]) => [FEATURE_LABELS[k] ?? k, v])} />
          </div>
          <p className="a-muted a-small-text">
            개인을 알아볼 수 있는 정보는 기록하지 않습니다. 관리자 화면과 개발 중(localhost) 접속은 통계에서 빠집니다. 기록은 180일 보관합니다.
            방문자 수·유입 경로의 더 자세한 그래프는 Vercel 프로젝트의 Analytics 탭에서도 볼 수 있습니다.
          </p>
        </>
      )}
    </div>
  )
}

function Stat({ label, value, note }) {
  return (
    <div className="a-card a-stat">
      <span className="a-muted">{label}</span>
      <b>{value.toLocaleString('ko-KR')}</b>
      <span className="a-muted a-small-text">{note}</span>
    </div>
  )
}

// 순위 목록 + 비율 막대 (한 가지 색)
function RankCard({ title, rows }) {
  const max = rows[0]?.[1] ?? 0
  return (
    <section className="a-card a-pad">
      <h3 className="a-h3">{title}</h3>
      {rows.length === 0 ? (
        <p className="a-empty">기록이 없습니다.</p>
      ) : (
        <ul className="a-bars">
          {rows.map(([k, v]) => (
            <li key={k}>
              <span className="a-bar-label" title={k}>
                {k}
              </span>
              <span className="a-bar-track" aria-hidden="true">
                <span className="a-bar-fill" style={{ width: `${(v / max) * 100}%` }} />
              </span>
              <span className="a-num">{v}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// 일별 방문자 막대 그래프 (한 계열이라 범례 없음, 막대에 마우스를 올리면 값 표시)
function DailyChart({ data }) {
  const max = Math.max(1, ...data.map((d) => d.value))
  const step = data.length > 31 ? 7 : data.length > 10 ? 3 : 1 // 날짜 라벨 간격
  return (
    <section className="a-card a-pad">
      <h3 className="a-h3">일별 방문자</h3>
      <div className="a-chart" role="img" aria-label={data.map((d) => `${d.day} ${d.value}명`).join(', ')}>
        <div className="a-chart-max a-muted">{max}명</div>
        <div className="a-chart-bars">
          {data.map((d, i) => (
            <div key={d.day} className="a-col" tabIndex={0} aria-label={`${d.day} ${d.value}명`}>
              <span className="a-tip">
                {d.day.slice(5).replace('-', '.')} · {d.value}명
              </span>
              <span className="a-col-bar" style={{ height: `${(d.value / max) * 100}%` }} />
              <span className="a-col-label">{i % step === 0 || i === data.length - 1 ? d.day.slice(5).replace('-', '.') : ''}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
