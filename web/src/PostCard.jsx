// 소식 카드: 누르면 상세 창이 열림. 매장 이름(ⓘ)은 매장 정보 창
import { useState } from 'react'
import { imageUrl, thumbUrl } from './supabase.js'
import { bodyOf, dateRange, timeAgo, titleOf } from './format.js'
import { scheduleLabel } from './sort.js'

const MAX_WORKS = 3

export default function PostCard({ post, now, shopName, showBranch, isNew, fav = false, onOpen, onShopClick }) {
  const [imgFailed, setImgFailed] = useState(false)
  const [thumbFailed, setThumbFailed] = useState(false) // 작은 사진이 없으면 큰 사진으로
  const title = titleOf(post.caption)
  const body = bodyOf(post.caption, title)
  const when = dateRange(post.starts_at, post.ends_at)
  const label = scheduleLabel(post, now)
  const past = label?.kind === 'past'
  const thumb = thumbUrl(post.image_path)
  const src = thumb && !thumbFailed ? thumb : imageUrl(post.image_path)
  const extraWorks = post.works.length - MAX_WORKS

  // 카드 아무 곳이나 누르면 상세 (매장 이름 버튼은 따로)
  const open = (e) => {
    if (e.target.closest('.shop')) return
    onOpen()
  }

  return (
    <article
      className={`card card-clickable${isNew ? ' card-new' : ''}${fav ? ' card-fav' : ''}`}
      onClick={open}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && !e.target.closest('.shop') && (e.preventDefault(), onOpen())}
      tabIndex={0}
      role="button"
      aria-label={`${shopName} ${title}`}
    >
      <div className="card-media">
        {src && !imgFailed ? (
          <img src={src} alt="" loading="lazy" decoding="async" onError={() => (src === thumb ? setThumbFailed(true) : setImgFailed(true))} />
        ) : (
          <div className="card-noimg">사진 없음</div>
        )}
        {post.media_type === '동영상' && <span className="media-badge">▶ 릴스</span>}
        {fav && <span className="fav-badge">★ 내 매장</span>}
      </div>

      <div className="card-body">
        <div className="card-meta">
          <button
            type="button"
            className="shop"
            onClick={(e) => {
              e.stopPropagation()
              onShopClick()
            }}
            title="매장 정보 보기"
          >
            {fav && (
              <span className="fav-mark" title="즐겨찾기 매장" aria-label="즐겨찾기 매장">
                ★
              </span>
            )}
            {shopName}
            {showBranch && post.branches.length > 0 && <span className="branch"> · {post.branches.join(', ')}</span>}
            <span className="shop-info-icon" aria-hidden="true">ⓘ</span>
          </button>
          <time dateTime={post.posted_at} title={new Date(post.posted_at).toLocaleString('ko-KR')}>
            {timeAgo(post.posted_at, now)}
          </time>
        </div>

        <div className="tags">
          <span className={`tag cat cat-${post.category.replace(/[^가-힣]/g, '')}`}>{post.category}</span>
          {post.goods_type.map((t) => (
            <span key={t} className="tag type">
              {t}
            </span>
          ))}
        </div>

        {title && <h3 className="card-title">{title}</h3>}

        {when && (
          <p className="when">
            {label && <span className={`status status-${label.kind}`}>{label.text}</span>}
            <span className={past ? 'past' : ''}>📅 {when}</span>
          </p>
        )}

        {post.works.length > 0 && (
          <div className="works">
            {post.works.slice(0, MAX_WORKS).map((w) => (
              <span key={w} className="work">
                {w}
              </span>
            ))}
            {extraWorks > 0 && <span className="work more">+{extraWorks}</span>}
          </div>
        )}
      </div>

      {/* 본문 미리보기 두 줄 (전체는 상세 창에서) */}
      {body && (
        <div className="card-foot">
          <p className="card-text">{body}</p>
        </div>
      )}
    </article>
  )
}
