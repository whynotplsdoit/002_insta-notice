// 글 분류 고치기: 분류·상품 종류·작품·일정 직접 수정, 글 완전 삭제
// 관리자가 저장한 글은 "분류 완료" 표시가 붙고 크롤러가 자동 분류로 덮어쓰지 않습니다.
import { useCallback, useEffect, useState } from 'react'
import { imageUrl, supabase } from '../supabase.js'
import { titleOf } from '../format.js'
import { CATEGORIES, GOODS_TYPES, fmtTime, fromKstDate, fromList, toKstDate, toList } from './util.js'
import { deletePost } from './deletePost.js'

const PAGE = 50

export default function Posts() {
  const [rows, setRows] = useState(null)
  const [shops, setShops] = useState([])
  const [q, setQ] = useState('')
  const [shop, setShop] = useState('')
  const [category, setCategory] = useState('')
  const [only, setOnly] = useState('') // '' | manual | hidden
  const [limit, setLimit] = useState(PAGE)
  const [openCode, setOpenCode] = useState(null)

  useEffect(() => {
    supabase
      .from('accounts')
      .select('username, display_name')
      .order('display_name')
      .then(({ data }) => setShops(data ?? []))
  }, [])

  const load = useCallback(async () => {
    let query = supabase.from('posts').select('*').order('posted_at', { ascending: false }).limit(limit)
    if (shop) query = query.eq('account_username', shop)
    if (category) query = query.eq('category', category)
    if (only === 'manual') query = query.eq('manual', true)
    if (only === 'review') query = query.eq('needs_review', true)
    if (q.trim()) query = query.ilike('caption', `%${q.trim()}%`)
    const { data } = await query
    setRows(data ?? [])
  }, [shop, category, only, q, limit])

  useEffect(() => {
    const t = setTimeout(load, 250) // 검색어 입력 중에는 잠깐 기다림
    return () => clearTimeout(t)
  }, [load])

  const nameOf = (u) => shops.find((s) => s.username === u)?.display_name ?? u

  return (
    <div className="a-stack">
      <div className="a-filters">
        <input className="a-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="본문 검색" />
        <select className="a-input" value={shop} onChange={(e) => setShop(e.target.value)}>
          <option value="">모든 매장</option>
          {shops.map((s) => (
            <option key={s.username} value={s.username}>
              {s.display_name}
            </option>
          ))}
        </select>
        <select className="a-input" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">모든 분류</option>
          {CATEGORIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <select className="a-input" value={only} onChange={(e) => setOnly(e.target.value)}>
          <option value="">전체 글</option>
          <option value="manual">분류 완료 글</option>
          <option value="review">검토 대기 글</option>
        </select>
      </div>

      {!rows && <p className="a-empty">불러오는 중…</p>}
      {rows && rows.length === 0 && <p className="a-empty">글이 없습니다.</p>}
      {rows && rows.length > 0 && (
        <div className="a-card a-list">
          {rows.map((p) => (
            <div key={p.code}>
              <button className="a-row a-row-btn a-post-row" onClick={() => setOpenCode(openCode === p.code ? null : p.code)}>
                {p.image_path ? <img className="a-thumb" src={imageUrl(p.image_path)} alt="" loading="lazy" /> : <div className="a-thumb" />}
                <div className="a-row-main">
                  <div className="a-post-title">{titleOf(p.caption) || '(본문 없음)'}</div>
                  <div className="a-muted a-small-text">
                    {nameOf(p.account_username)} · {fmtTime(p.posted_at)} · {p.category}
                    {p.goods_type.length > 0 && ` · ${p.goods_type.join(', ')}`}
                    {p.works.length > 0 && ` · ${p.works.slice(0, 2).join(', ')}${p.works.length > 2 ? ' 외' : ''}`}
                  </div>
                </div>
                {p.manual && <span className="a-pill info">분류 완료</span>}
                {p.needs_review && <span className="a-pill warn">검토 대기</span>}
              </button>
              {openCode === p.code && (
                <PostEditor
                  post={p}
                  onSaved={(updated) => setRows(rows.map((x) => (x.code === updated.code ? updated : x)))}
                  onDeleted={() => {
                    setOpenCode(null)
                    setRows(rows.filter((x) => x.code !== p.code))
                  }}
                />
              )}
            </div>
          ))}
        </div>
      )}
      {rows && rows.length === limit && (
        <button className="a-btn" onClick={() => setLimit(limit + PAGE)}>
          더 보기
        </button>
      )}
    </div>
  )
}

function PostEditor({ post, onSaved, onDeleted }) {
  const [category, setCategory] = useState(post.category)
  const [types, setTypes] = useState(post.goods_type)
  const [works, setWorks] = useState(fromList(post.works))
  const [start, setStart] = useState(toKstDate(post.starts_at))
  const [end, setEnd] = useState(toKstDate(post.ends_at))
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const remove = async () => {
    setDeleting(true)
    const error = await deletePost(post)
    setDeleting(false)
    if (error === 'cancel') return
    if (error) return alert(`삭제하지 못했습니다: ${error}`)
    onDeleted()
  }

  const save = async (patch) => {
    setSaving(true)
    const { data, error } = await supabase.from('posts').update(patch).eq('code', post.code).select().single()
    setSaving(false)
    if (error) return alert(`저장하지 못했습니다: ${error.message}`)
    onSaved(data)
  }

  const saveManual = () =>
    save({
      category,
      goods_type: category === '입고' ? types : [],
      works: toList(works),
      starts_at: fromKstDate(start),
      ends_at: fromKstDate(end),
      manual: true,
      // 관리자가 보고 저장했으니 검토 끝 → 사이트에 게시
      needs_review: false,
      hidden: false,
    })

  return (
    <div className="a-editor">
      <p className="a-caption">{post.caption || '(본문 없음)'}</p>
      <div className="a-grid3">
        <label className="a-field">
          <span>분류</span>
          <select className="a-input" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="a-field">
          <span>시작일</span>
          <input className="a-input" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="a-field">
          <span>종료일</span>
          <input className="a-input" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
      </div>
      {category === '입고' && (
        <div className="a-field">
          <span>상품 종류</span>
          <div className="a-checks">
            {GOODS_TYPES.map((t) => (
              <label key={t} className="a-check">
                <input
                  type="checkbox"
                  checked={types.includes(t)}
                  onChange={(e) => setTypes(e.target.checked ? [...types, t] : types.filter((x) => x !== t))}
                />
                {t}
              </label>
            ))}
          </div>
        </div>
      )}
      <label className="a-field">
        <span>작품 (쉼표로 구분)</span>
        <input className="a-input" value={works} onChange={(e) => setWorks(e.target.value)} placeholder="예: 명탐정 코난, 치이카와" />
      </label>
      <div className="a-actions">
        <button className="a-btn a-danger" disabled={saving || deleting} onClick={remove}>
          {deleting ? '삭제 중…' : '삭제'}
        </button>
        {post.manual && (
          <button className="a-btn" disabled={saving} onClick={() => save({ manual: false })} title="다음 수집 때 자동 분류로 다시 채워집니다">
            자동 분류로 되돌리기
          </button>
        )}
        <span className="a-spacer" />
        <a className="a-btn" href={post.url} target="_blank" rel="noopener noreferrer">
          인스타 ↗
        </a>
        <button className="a-btn a-primary" disabled={saving || deleting} onClick={saveManual}>
          {saving ? '저장 중…' : post.needs_review ? '저장하고 게시' : '저장'}
        </button>
      </div>
    </div>
  )
}
