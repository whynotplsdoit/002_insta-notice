// 수집 상태: 로그인 풀림 경고, 매장별 마지막 수집, 분류별 글 개수, 최근 수집 기록
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../supabase.js'
import { CATEGORIES, ago, fmtTime } from './util.js'

const STALE_HOURS = 26 // 정기 확인이 24시간마다라 이보다 오래되면 문제

export default function Status() {
  const [logs, setLogs] = useState(null)
  const [shops, setShops] = useState([])
  const [level, setLevel] = useState('all')
  const [counts, setCounts] = useState(null) // 글 개수 { total, 입고, ..., review }

  const load = useCallback(async () => {
    const head = (q) => q.then(({ count }) => count ?? 0)
    const posts = () => supabase.from('posts').select('code', { count: 'exact', head: true })
    const [l, a, total, review, ...byCat] = await Promise.all([
      supabase.from('crawl_logs').select('*').order('created_at', { ascending: false }).limit(200),
      supabase.from('accounts').select('username, display_name, last_crawled_at, hidden').order('last_crawled_at'),
      head(posts()),
      head(posts().eq('needs_review', true)),
      ...CATEGORIES.map((c) => head(posts().eq('category', c))),
    ])
    setLogs(l.data ?? [])
    setShops((a.data ?? []).filter((s) => !s.hidden))
    setCounts({ total, review, byCat: CATEGORIES.map((c, i) => [c, byCat[i]]) })
  }, [])

  // 처음 한 번 불러오고, 그 뒤로는 크롤러가 기록을 남길 때만 다시 불러옴 (실시간 알림)
  // 한 번 수집할 때 기록이 여러 줄 생기므로 마지막 기록 뒤 3초 기다렸다가 한 번만
  const [, tick] = useState(0)
  useEffect(() => {
    load()
    let wait = null
    const channel = supabase
      .channel('crawl-logs')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'crawl_logs' }, () => {
        clearTimeout(wait)
        wait = setTimeout(load, 3000)
      })
      .subscribe()
    // "13분 전" 같은 시간 표시만 1분마다 다시 그림 (DB는 읽지 않음)
    const clock = setInterval(() => tick((n) => n + 1), 60_000)
    return () => {
      clearTimeout(wait)
      clearInterval(clock)
      supabase.removeChannel(channel)
    }
  }, [load])

  if (!logs) return <p className="a-empty">불러오는 중…</p>

  const lastRun = logs.find((l) => l.message.startsWith('피드 확인'))
  const loginError = logs.find((l) => l.message.includes('로그인이 풀려'))
  const loginBroken = loginError && (!lastRun || new Date(loginError.created_at) > new Date(lastRun.created_at))
  const stale = shops.filter((s) => !s.last_crawled_at || Date.now() - new Date(s.last_crawled_at).getTime() > STALE_HOURS * 3600_000)
  const shown = level === 'all' ? logs : logs.filter((l) => l.level !== 'info')

  return (
    <div className="a-stack">
      {loginBroken && (
        <div className="a-alert err">
          <b>인스타그램 로그인이 풀렸습니다.</b> 이 PC에서 <code>npm run login</code> 을 실행해 부계정으로 다시 로그인하세요.
          <div className="a-small-text">{fmtTime(loginError.created_at)}</div>
        </div>
      )}

      <div className="a-stats">
        <div className="a-card a-stat">
          <span className="a-muted">마지막 자동 확인</span>
          <b>{ago(lastRun?.created_at)}</b>
          <span className="a-muted a-small-text">15분마다 · 9~24시</span>
        </div>
        <div className="a-card a-stat">
          <span className="a-muted">수집 중인 매장</span>
          <b>{shops.length}곳</b>
        </div>
        <div className={`a-card a-stat${stale.length ? ' warn' : ''}`}>
          <span className="a-muted">오래 수집 안 된 매장</span>
          <b>{stale.length}곳</b>
          {stale.length > 0 && <span className="a-small-text">{stale.map((s) => s.display_name).join(', ')}</span>}
        </div>
      </div>
      {counts && (
        <div className="a-card a-pad">
          <div className="a-h2-row">
            <h3 className="a-h3" style={{ margin: 0 }}>
              수집된 글 <span className="a-num">{counts.total}개</span>
            </h3>
            {counts.review > 0 && <span className="a-pill warn">검토 대기 {counts.review}</span>}
          </div>
          <ul className="a-bars a-bars-even">
            {counts.byCat.map(([c, n]) => (
              <li key={c}>
                <span className="a-bar-label">{c}</span>
                <span className="a-bar-track" aria-hidden="true">
                  <span className="a-bar-fill" style={{ width: `${counts.total ? (n / counts.total) * 100 : 0}%` }} />
                </span>
                <span className="a-num">
                  {n}개 <span className="a-muted">({counts.total ? Math.round((n / counts.total) * 100) : 0}%)</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {lastRun && Date.now() - new Date(lastRun.created_at).getTime() > 60 * 60_000 && (
        <div className="a-alert warn">
          1시간 넘게 자동 확인 기록이 없습니다. 밤 시간(0~9시)이 아니라면 PC가 꺼져 있거나 작업 스케줄러가 멈췄을 수 있습니다.
        </div>
      )}

      <section>
        <div className="a-h2-row">
          <h2 className="a-h2">수집 기록</h2>
          <select className="a-input a-input-sm" value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="all">전체</option>
            <option value="problem">문제만</option>
          </select>
          <button className="a-btn a-small" onClick={load}>
            새로고침
          </button>
        </div>
        <div className="a-card a-list a-logs">
          {shown.length === 0 && <p className="a-empty">기록이 없습니다.</p>}
          {shown.map((l) => (
            <div key={l.id} className={`a-log ${l.level}`}>
              <span className="a-log-time">{fmtTime(l.created_at)}</span>
              <span>{l.message}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
