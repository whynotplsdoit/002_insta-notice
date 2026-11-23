// 게시물 불러오기 + 새로고침 없이 갱신
// - 실시간: 새 글이 들어오면 바로 "새 소식 N개" 표시 (누르면 목록에 반영)
// - 예비: 실시간 연결이 끊겨도 5분마다, 그리고 화면으로 돌아올 때마다 새 글 확인
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase.js'

const LIMIT = 500
const POLL_MS = 5 * 60 * 1000
const COLUMNS =
  'code, account_username, url, posted_at, media_type, pinned, caption, category, goods_type, works, branches, starts_at, ends_at, image_path, first_seen_at'

const byPostedDesc = (a, b) => b.posted_at.localeCompare(a.posted_at)

export function usePosts() {
  const [posts, setPosts] = useState([])
  const [accounts, setAccounts] = useState([])
  const [branches, setBranches] = useState([])
  const [pending, setPending] = useState([]) // 아직 목록에 반영하지 않은 새 글
  const [status, setStatus] = useState('loading') // loading | ready | error
  const [live, setLive] = useState(false) // 실시간 연결 여부
  const known = useRef(new Set())

  const load = useCallback(async () => {
    const [p, a, b] = await Promise.all([
      supabase.from('posts').select(COLUMNS).eq('hidden', false).order('posted_at', { ascending: false }).limit(LIMIT),
      supabase.from('accounts').select('username, display_name, account_type').eq('hidden', false),
      supabase.from('branches').select('account_username, name, region'),
    ])
    if (p.error || a.error || b.error) {
      setStatus('error')
      return
    }
    known.current = new Set(p.data.map((x) => x.code))
    setPosts(p.data)
    setAccounts(a.data)
    setBranches(b.data)
    setPending([])
    setStatus('ready')
  }, [])

  // 새 글 확인 (예비 방식)
  const checkNew = useCallback(async () => {
    const { data, error } = await supabase
      .from('posts')
      .select(COLUMNS)
      .eq('hidden', false)
      .order('first_seen_at', { ascending: false })
      .limit(50)
    if (error) return
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
      .subscribe((s) => setLive(s === 'SUBSCRIBED'))

    const timer = setInterval(checkNew, POLL_MS)
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

  return { posts, accounts, branches, pending, showPending, status, live, reload: load }
}
