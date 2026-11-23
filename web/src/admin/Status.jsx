// 수집 상태: 로그인 풀림 경고, 매장별 마지막 수집, 최근 수집 기록
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../supabase.js'
import { ago, fmtTime } from './util.js'

const STALE_HOURS = 26 // 정기 확인이 24시간마다라 이보다 오래되면 문제

export default function Status() {
  const [logs, setLogs] = useState(null)
  const [shops, setShops] = useState([])
  const [level, setLevel] = useState('all')

  const load = useCallback(async () => {
    const [l, a] = await Promise.all([
      supabase.from('crawl_logs').select('*').order('created_at', { ascending: false }).limit(200),
      supabase.from('accounts').select('username, display_name, last_crawled_at, hidden').order('last_crawled_at'),
    ])
    setLogs(l.data ?? [])
    setShops((a.data ?? []).filter((s) => !s.hidden))
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 60_000)
    return () => clearInterval(t)
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
