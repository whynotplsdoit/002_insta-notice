// 관리자 화면 (/admin)
// 이메일 링크로 로그인 → DB의 관리자 목록에 있는 사람만 사용 가능
import { useCallback, useEffect, useState } from 'react'
import { supabase, configured } from '../supabase.js'
import Requests from './Requests.jsx'
import Shops from './Shops.jsx'
import Status from './Status.jsx'
import Posts from './Posts.jsx'
import './admin.css'

const TABS = [
  { id: 'requests', label: '매장 신청' },
  { id: 'shops', label: '매장 관리' },
  { id: 'status', label: '수집 상태' },
  { id: 'posts', label: '글 분류' },
]

export default function Admin() {
  const [session, setSession] = useState(undefined) // undefined = 확인 중
  const [isAdmin, setIsAdmin] = useState(null)

  useEffect(() => {
    document.title = '관리자 · 굿즈레이더'
    if (!configured) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) return setIsAdmin(null)
    supabase.rpc('is_admin').then(({ data }) => setIsAdmin(Boolean(data)))
  }, [session])

  if (!configured) return <Shell><p className="a-empty">Supabase 연결 정보가 없습니다.</p></Shell>
  if (session === undefined || (session && isAdmin === null)) return <Shell><p className="a-empty">확인 중…</p></Shell>
  if (!session) return <Shell><Login /></Shell>
  if (!isAdmin) {
    return (
      <Shell>
        <div className="a-card a-login">
          <h2>관리자 권한이 없습니다</h2>
          <p className="a-muted">{session.user.email} 계정은 관리자로 등록되어 있지 않습니다.</p>
          <button className="a-btn" onClick={() => supabase.auth.signOut()}>로그아웃</button>
        </div>
      </Shell>
    )
  }
  return <Dashboard email={session.user.email} />
}

function Shell({ children, right }) {
  return (
    <div className="admin">
      <header className="a-header">
        <a className="a-logo" href="/">
          <img src="/favicon-64.png" alt="" width="28" height="28" />
          굿즈레이더 <span>관리자</span>
        </a>
        <div className="a-header-right">{right}</div>
      </header>
      <main className="a-main">{children}</main>
    </div>
  )
}

// 이 브라우저에서 마지막으로 쓴 관리자 이메일 기억 (사이트 코드에는 이메일을 넣지 않음)
const EMAIL_KEY = 'goods-radar:admin-email'
const savedEmail = () => {
  try {
    return localStorage.getItem(EMAIL_KEY) ?? ''
  } catch {
    return ''
  }
}

function Login() {
  const [email, setEmail] = useState(savedEmail)
  const [state, setState] = useState('idle') // idle | sending | sent
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    setState('sending')
    setError('')
    try {
      localStorage.setItem(EMAIL_KEY, email.trim())
    } catch {
      // 저장 못 해도 괜찮음
    }
    const { error: err } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/admin` },
    })
    if (err) {
      setState('idle')
      setError(/signups|not allowed|not found/i.test(err.message) ? '등록된 관리자 이메일이 아닙니다.' : `보내지 못했습니다: ${err.message}`)
      return
    }
    setState('sent')
  }

  if (state === 'sent') {
    return (
      <div className="a-card a-login">
        <h2>메일을 확인하세요</h2>
        <p className="a-muted">
          <b>{email}</b> 로 로그인 링크를 보냈습니다.
          <br />
          메일의 링크를 누르면 이 화면으로 돌아와 로그인됩니다.
        </p>
        <button className="a-btn" onClick={() => setState('idle')}>다시 보내기</button>
      </div>
    )
  }
  return (
    <form className="a-card a-login" onSubmit={submit}>
      <h2>관리자 로그인</h2>
      <p className="a-muted">관리자 이메일을 입력하면 로그인 링크를 보내드립니다.</p>
      <input
        className="a-input"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="이메일"
        autoComplete="email"
        autoFocus={!email}
        required
      />
      {error && <p className="a-error">{error}</p>}
      <button className="a-btn a-primary" disabled={state === 'sending'}>
        {state === 'sending' ? '보내는 중…' : '로그인 링크 받기'}
      </button>
    </form>
  )
}

function Dashboard({ email }) {
  const [tab, setTab] = useState(() => new URLSearchParams(window.location.search).get('tab') ?? 'requests')
  const [pendingCount, setPendingCount] = useState(0)

  const go = (id) => {
    setTab(id)
    window.history.replaceState(null, '', `/admin?tab=${id}`)
  }

  const count = useCallback(
    () =>
      supabase
        .from('shop_requests')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending')
        .then(({ count: n }) => setPendingCount(n ?? 0)),
    [],
  )
  useEffect(() => {
    count()
    const t = setInterval(count, 60_000)
    return () => clearInterval(t)
  }, [count])

  return (
    <Shell
      right={
        <>
          <span className="a-muted a-hide-sm">{email}</span>
          <button className="a-btn a-small" onClick={() => supabase.auth.signOut()}>로그아웃</button>
        </>
      }
    >
      <nav className="a-tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => go(t.id)}>
            {t.label}
            {t.id === 'requests' && pendingCount > 0 && <span className="a-badge">{pendingCount}</span>}
          </button>
        ))}
      </nav>
      {tab === 'requests' && <Requests onChange={count} />}
      {tab === 'shops' && <Shops />}
      {tab === 'status' && <Status />}
      {tab === 'posts' && <Posts />}
    </Shell>
  )
}
