// 기타 검토: '기타'로 분류된 글을 보고 [검토 완료] 또는 [삭제]
// - 검토 대기 중에도 사이트 "전체" 탭에는 보임
// - 검토 완료: 그대로 두거나 분류를 바꿔서 확정 (크롤러가 덮어쓰지 않음)
// - 삭제: 글과 사진을 완전히 지우고, 다시 수집되지 않게 기록
import { useCallback, useEffect, useState } from 'react'
import { imageUrl, supabase } from '../supabase.js'
import { CATEGORIES, fmtTime } from './util.js'
import { deletePost } from './deletePost.js'

export default function Review({ onChange }) {
  const [rows, setRows] = useState(null)
  const [names, setNames] = useState(new Map())

  const load = useCallback(async () => {
    const [p, a] = await Promise.all([
      supabase.from('posts').select('*').eq('needs_review', true).order('posted_at', { ascending: false }),
      supabase.from('accounts').select('username, display_name'),
    ])
    setRows(p.data ?? [])
    setNames(new Map((a.data ?? []).map((x) => [x.username, x.display_name])))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const done = (code) => {
    setRows((list) => list.filter((x) => x.code !== code))
    onChange?.()
  }

  if (!rows) return <p className="a-empty">불러오는 중…</p>

  return (
    <div className="a-stack">
      <div>
        <h2 className="a-h2">검토할 글 {rows.length}개</h2>
        <p className="a-muted a-small-text">
          자동 분류에서 '기타'로 나온 글입니다. 검토 중에도 사이트 "전체" 탭에는 보입니다. 분류를 확정하거나 삭제하세요.
        </p>
      </div>
      {rows.length === 0 && <p className="a-empty">검토할 글이 없습니다.</p>}
      {rows.map((p) => (
        <ReviewCard key={p.code} post={p} shopName={names.get(p.account_username) ?? p.account_username} onDone={done} />
      ))}
    </div>
  )
}

function ReviewCard({ post, shopName, onDone }) {
  const [category, setCategory] = useState('기타')
  const [busy, setBusy] = useState(false)

  const publish = async () => {
    setBusy(true)
    const { error } = await supabase
      .from('posts')
      .update({
        category,
        goods_type: category === '입고' ? ['굿즈'] : [],
        hidden: false,
        needs_review: false,
        manual: true, // 관리자가 정한 분류를 크롤러가 덮어쓰지 않게
      })
      .eq('code', post.code)
    setBusy(false)
    if (error) return alert(`저장하지 못했습니다: ${error.message}`)
    onDone(post.code)
  }

  const remove = async () => {
    setBusy(true)
    const error = await deletePost(post)
    setBusy(false)
    if (error === 'cancel') return
    if (error) return alert(`삭제하지 못했습니다: ${error}`)
    onDone(post.code)
  }

  return (
    <div className="a-card a-review">
      <a className="a-review-img" href={post.url} target="_blank" rel="noopener noreferrer">
        {post.image_path ? <img src={imageUrl(post.image_path)} alt="" loading="lazy" /> : <span>사진 없음</span>}
        {post.media_type === '동영상' && <span className="a-review-badge">▶ 릴스</span>}
      </a>
      <div className="a-review-body">
        <div className="a-request-head">
          <span className="a-strong">{shopName}</span>
          <span className="a-muted a-small-text">{fmtTime(post.posted_at)}</span>
        </div>
        <p className="a-caption">{post.caption || '(본문 없음)'}</p>
        <div className="a-actions a-review-actions">
          <button className="a-btn a-danger" disabled={busy} onClick={remove}>
            삭제
          </button>
          <span className="a-spacer" />
          <select className="a-input a-input-sm" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="확정할 분류">
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <button className="a-btn a-primary" disabled={busy} onClick={publish}>
            검토 완료
          </button>
        </div>
      </div>
    </div>
  )
}
