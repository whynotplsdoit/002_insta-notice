// 글 상세 창: 카드를 누르면 열림 (휴대폰은 아래에서 올라오는 판, PC는 가운데 창)
// 큰 사진 → 매장(누르면 매장 정보) → 분류·종류 → 제목 → 일정 → 작품 → 본문 전체 → 인스타그램
import { useEffect, useRef, useState } from 'react'
import { imageUrl } from './supabase.js'
import { bodyOf, dateRange, timeAgo, titleOf } from './format.js'
import { scheduleLabel } from './sort.js'
import { track } from './track.js'
import { useScrollLock } from './useScrollLock.js'
import { useBackToClose } from './useBackToClose.js'

export default function PostDetail({ post, shop, showBranch, now, onShopOpen, onClose }) {
  const dialogRef = useRef(null)
  const [imgFailed, setImgFailed] = useState(false)
  useScrollLock()
  useBackToClose(onClose)
  useEffect(() => {
    dialogRef.current?.showModal?.()
  }, [])

  const title = titleOf(post.caption)
  const body = bodyOf(post.caption, title)
  const when = dateRange(post.starts_at, post.ends_at)
  const label = scheduleLabel(post, now)
  const src = imageUrl(post.image_path)
  const photo = shop?.profile_image_path ? `${imageUrl(shop.profile_image_path)}?v=${encodeURIComponent(shop.profile_updated_at ?? '')}` : null

  return (
    <dialog
      ref={dialogRef}
      className="modal sheet post-modal"
      aria-label={title || '소식 상세'}
      onClose={onClose}
      onClick={(e) => e.target === dialogRef.current && onClose()}
    >
      <div className="post-sheet">
        <button type="button" className="sheet-close on-image" onClick={onClose} aria-label="닫기">
          ✕
        </button>

        <div className="post-hero">
          {src && !imgFailed ? (
            <img src={src} alt="" onError={() => setImgFailed(true)} />
          ) : (
            <div className="card-noimg">사진 없음</div>
          )}
          {post.media_type === '동영상' && <span className="media-badge">▶ 릴스</span>}
        </div>

        <div className="post-body">
          <button type="button" className="post-shop" onClick={onShopOpen} title="매장 정보 보기">
            {photo ? <img src={photo} alt="" /> : <span className="post-shop-ph">{shop?.display_name?.[0] ?? '?'}</span>}
            <span className="post-shop-text">
              <b>
                {shop?.display_name ?? post.account_username}
                {showBranch && post.branches.length > 0 && <span> · {post.branches.join(', ')}</span>}
              </b>
              <small>{timeAgo(post.posted_at, now)} · 매장 정보 보기 ›</small>
            </span>
          </button>

          <div className="tags">
            <span className={`tag cat cat-${post.category.replace(/[^가-힣]/g, '')}`}>{post.category}</span>
            {post.goods_type.map((t) => (
              <span key={t} className="tag type">
                {t}
              </span>
            ))}
          </div>

          {title && <h2 className="post-title">{title}</h2>}

          {when && (
            <p className="when">
              {label && <span className={`status status-${label.kind}`}>{label.text}</span>}
              <span className={label?.kind === 'past' ? 'past' : ''}>📅 {when}</span>
            </p>
          )}

          {post.works.length > 0 && (
            <div className="works">
              {post.works.map((w) => (
                <span key={w} className="work">
                  {w}
                </span>
              ))}
            </div>
          )}

          {body && <p className="post-text">{body}</p>}

          <a
            className="btn btn-primary post-insta"
            href={post.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => track('insta_click', post.code, { shop: post.account_username, from: 'detail' })}
          >
            인스타그램에서 보기 ↗
          </a>
        </div>
      </div>
    </dialog>
  )
}
