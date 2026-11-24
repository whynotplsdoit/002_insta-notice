import { useLayoutEffect, useRef, useState } from 'react'
import { imageUrl } from './supabase.js'
import { bodyOf, dateRange, timeAgo, titleOf } from './format.js'
import { scheduleLabel } from './sort.js'
import { track } from './track.js'

const MAX_WORKS = 3

export default function PostCard({ post, now, shopName, showBranch, isNew, onShopClick }) {
  const [open, setOpen] = useState(false)
  const [imgFailed, setImgFailed] = useState(false)
  const title = titleOf(post.caption)
  const body = bodyOf(post.caption, title)
  const when = dateRange(post.starts_at, post.ends_at)
  const label = scheduleLabel(post, now)
  const past = label?.kind === 'past'
  const src = imageUrl(post.image_path)
  const extraWorks = post.works.length - MAX_WORKS

  // 본문이 실제로 3줄을 넘어 잘렸을 때만 "더보기" 버튼 표시
  const textRef = useRef(null)
  const [clamped, setClamped] = useState(false)
  useLayoutEffect(() => {
    const el = textRef.current
    if (!el || open) return
    const measure = () => setClamped(el.scrollHeight > el.clientHeight + 1)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [body, open])

  return (
    <article className={`card${isNew ? ' card-new' : ''}`}>
      <a
        className="card-media"
        href={post.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="인스타그램에서 보기"
        onClick={() => track('insta_click', post.code, { shop: post.account_username, from: 'image' })}
      >
        {src && !imgFailed ? (
          <img src={src} alt="" loading="lazy" decoding="async" onError={() => setImgFailed(true)} />
        ) : (
          <div className="card-noimg">사진 없음</div>
        )}
        {post.media_type === '동영상' && <span className="media-badge">▶ 릴스</span>}
      </a>

      <div className="card-body">
        <div className="card-meta">
          <button type="button" className="shop" onClick={onShopClick} title="매장 정보 보기">
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

      {/* 본문: PC는 카드 아래쪽, 휴대폰은 사진·정보 아래에 카드 전체 너비로 */}
      <div
        className={`card-foot${open ? ' open' : ''}${body ? '' : ' no-body'}${clamped || open ? ' has-toggle' : ''}`}
      >
        {body && (
          <p ref={textRef} className={`card-text${open ? ' open' : ''}`}>
            {body}
          </p>
        )}
        {/* 아래 액션 줄: 왼쪽 더보기/접기, 오른쪽 인스타그램 */}
        <div className="card-actions">
          {(clamped || open) && (
            <button type="button" className="toggle-btn more-btn"
              onClick={() => {
                if (!open) track('more', post.code, { shop: post.account_username })
                setOpen((v) => !v)
              }}
              aria-expanded={open}
            >
              <span>{open ? '접기' : '더보기'}</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points={open ? '18 15 12 9 6 15' : '6 9 12 15 18 9'} />
              </svg>
            </button>
          )}
          <a
            className="insta-pill-btn"
            href={post.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => track('insta_click', post.code, { shop: post.account_username, from: 'button' })}
          >
            <span>인스타그램</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="7" y1="17" x2="17" y2="7" />
              <polyline points="7 7 17 7 17 17" />
            </svg>
          </a>
        </div>
      </div>
    </article>
  )
}
