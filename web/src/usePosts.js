// 게시물 불러오기 + 새로고침 없이 갱신
// - 실시간: 새 글이 들어오면 바로 "새 소식 N개" 표시 (누르면 목록에 반영)
// - 예비: 실시간 연결이 끊겼을 때만 5분마다, 그리고 화면으로 돌아올 때 새 글 확인 (글 코드만 먼저 받아 봄)
// - 전송량 아끼기: 지난번 받은 데이터를 브라우저에 저장해 두고, 다시 오면 바뀐 글만 받음
//   매장·지점(100곳 남짓, 작음)은 열 때마다 새로 받음 — 관리자가 고친 지역·종류가 바로 보이게
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase.js'

const LIMIT = 500
const POLL_MS = 5 * 60 * 1000
const COLUMNS =
  'code, account_username, url, posted_at, media_type, pinned, caption, category, goods_type, works, branches, starts_at, ends_at, image_path, first_seen_at, updated_at'
const ACCOUNT_COLUMNS = 'username, display_name, account_type, ig_full_name, bio, external_url, profile_image_path, profile_updated_at'
const CACHE_KEY = 'goods-radar-data-v1'
const FULL_RELOAD_MS = 24 * 60 * 60 * 1000 // 하루 지나면 전부 새로 받음 (혹시 놓친 변경 정리)

const readCache = () => {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY))
    return c && Date.now() - c.fullAt < FULL_RELOAD_MS ? c : null
  } catch {
    return null
  }
}
const writeCache = (c) => {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(c))
  } catch {
    // 저장 공간이 없으면 그냥 다음에 전부 받음
  }
}
const maxUpdated = (rows) => rows.reduce((m, r) => (r.updated_at && r.updated_at > m ? r.updated_at : m), '')

// 지난번 데이터 + 바뀐 글만 받아서 합치기. 반환 null 이면 전부 새로 받아야 함
async function loadIncremental(cache) {
  const [codes, changed] = await Promise.all([
    supabase.from('posts').select('code').eq('hidden', false).order('posted_at', { ascending: false }).limit(LIMIT),
    supabase.from('posts').select(COLUMNS).eq('hidden', false).gte('updated_at', cache.cursor),
  ])
  if (codes.error || changed.error) return null
  const byCode = new Map(cache.posts.map((p) => [p.code, p]))
  for (const p of changed.data) byCode.set(p.code, p)
  const missing = codes.data.map((x) => x.code).filter((c) => !byCode.has(c))
  for (let i = 0; i < missing.length; i += 100) {
    const r = await supabase.from('posts').select(COLUMNS).in('code', missing.slice(i, i + 100))
    if (r.error) return null
    for (const p of r.data) byCode.set(p.code, p)
  }
  return codes.data.map((x) => byCode.get(x.code)).filter(Boolean)
}

const byPostedDesc = (a, b) => b.posted_at.localeCompare(a.posted_at)

export function usePosts() {
  const [posts, setPosts] = useState([])
  const [accounts, setAccounts] = useState([])
  const [branches, setBranches] = useState([])
  const [pending, setPending] = useState([]) // 아직 목록에 반영하지 않은 새 글
  const [status, setStatus] = useState('loading') // loading | ready | error
  const [live, setLive] = useState(false) // 실시간 연결 여부
  const known = useRef(new Set())
  const liveRef = useRef(false)

  const load = useCallback(async ({ fresh = false } = {}) => {
    const cache = fresh ? null : readCache()
    const show = (c) => {
      known.current = new Set(c.posts.map((x) => x.code))
      setPosts(c.posts)
      setAccounts(c.accounts)
      setBranches(c.branches)
      setPending([])
      setStatus('ready')
    }
    if (cache) show(cache) // 지난번 데이터로 바로 화면을 띄우고 뒤에서 갱신

    const [p, a, b] = await Promise.all([
      cache ? loadIncremental(cache) : null,
      supabase.from('accounts').select(ACCOUNT_COLUMNS).eq('hidden', false),
      supabase.from('branches').select('*').order('id'),
    ])
    let posts = p
    let fullAt = cache?.fullAt
    if (!posts) {
      const r = await supabase.from('posts').select(COLUMNS).eq('hidden', false).order('posted_at', { ascending: false }).limit(LIMIT)
      if (r.error) return cache ? undefined : setStatus('error')
      posts = r.data
      fullAt = Date.now()
    }
    if (a.error || b.error) return cache ? undefined : setStatus('error')
    const next = {
      fullAt,
      cursor: maxUpdated(posts) || cache?.cursor || '',
      posts,
      accounts: a.data,
      branches: b.data,
    }
    writeCache(next)
    show(next)
  }, [])

  // 새 글 확인 (예비 방식): 코드만 먼저 받아 보고, 모르는 글만 내용까지 받음
  const checkNew = useCallback(async () => {
    const { data: codes, error } = await supabase
      .from('posts')
      .select('code')
      .eq('hidden', false)
      .order('first_seen_at', { ascending: false })
      .limit(50)
    if (error) return
    const unknown = codes.map((x) => x.code).filter((c) => !known.current.has(c))
    if (unknown.length === 0) return
    const { data, error: e2 } = await supabase.from('posts').select(COLUMNS).in('code', unknown)
    if (e2) return
    const fresh = data.filter((x) => !known.current.has(x.code))
    if (fresh.length === 0) return
    for (const x of fresh) known.current.add(x.code)
    setPending((prev) => [...fresh, ...prev])
  }, [])

  useEffect(() => {
    load()

    const channel = supabase
      .channel('posts-feed')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, ({ new: row }) => {
        if (row.hidden || known.current.has(row.code)) return
        known.current.add(row.code)
        setPending((prev) => [row, ...prev])
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'posts' }, ({ new: row }) => {
        // 이미 보이는 글의 내용·분류가 바뀌면 그 자리에서 바로 갱신, 숨겨지면 빼기
        const apply = (prev) =>
          row.hidden ? prev.filter((x) => x.code !== row.code) : prev.map((x) => (x.code === row.code ? { ...x, ...row } : x))
        setPosts(apply)
        setPending(apply)
      })
      .subscribe((s) => {
        liveRef.current = s === 'SUBSCRIBED'
        setLive(liveRef.current)
      })

    // 실시간 연결이 살아 있으면 주기 확인은 건너뜀. 화면을 안 보고 있을 때도 건너뜀
    const timer = setInterval(() => !liveRef.current && document.visibilityState === 'visible' && checkNew(), POLL_MS)
    const onVisible = () => document.visibilityState === 'visible' && checkNew()
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      supabase.removeChannel(channel)
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load, checkNew])

  const showPending = useCallback(() => {
    if (pending.length === 0) return
    const codes = new Set(pending.map((x) => x.code))
    setPosts((prev) => [...pending, ...prev.filter((x) => !codes.has(x.code))].sort(byPostedDesc))
    setPending([])
  }, [pending])

  const reload = useCallback(() => load({ fresh: true }), [load])

  return { posts, accounts, branches, pending, showPending, status, live, reload }
}
