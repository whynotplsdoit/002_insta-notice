// 매장 정보 창: 카드의 매장 이름을 누르면 열림
// 위: 인스타 프로필(사진·이름·소개글) + 취급 상품·자주 나오는 작품 (모은 글로 계산)
// 아래: 지점별 칸 (영업 상태·주소·전화·네이버 지도·영업시간)
import { useEffect, useMemo, useRef, useState } from 'react'
import { imageUrl } from './supabase.js'
import { hoursLines, openStatus, todayName } from './hours.js'
import { track } from './track.js'
import { FavButton } from './favorites.jsx'
import { ONLINE } from './regions.js'
import { useScrollLock } from './useScrollLock.js'
import { useBackToClose } from './useBackToClose.js'

const GOODS_TYPES = ['쿠지', '가챠', '피규어', '굿즈']

function mapUrl(branch, shopName) {
  if (branch.naver_place_id) return `https://map.naver.com/p/entry/place/${branch.naver_place_id}`
  const q = branch.address || `${shopName} ${branch.name}`
  return `https://map.naver.com/p/search/${encodeURIComponent(q)}`
}

export default function ShopInfo({ account, branches, posts, focusBranches = [], now, fav = false, onToggleFav, onClose }) {
  const dialogRef = useRef(null)
  useScrollLock() // 창이 열려 있는 동안 뒤 목록은 스크롤되지 않게
  useBackToClose(onClose) // 휴대폰 뒤로 가기로 닫기
  useEffect(() => {
    dialogRef.current?.showModal?.()
  }, [])

  // 이 글의 지점을 맨 위로, 나머지는 그 뒤로
  const ordered = useMemo(() => {
    const focus = branches.filter((b) => focusBranches.includes(b.name))
    return [...focus, ...branches.filter((b) => !focusBranches.includes(b.name))]
  }, [branches, focusBranches])
  const focused = branches.length > 1 && focusBranches.length > 0 && focusBranches.length < branches.length

  // 취급 상품 비율(입고 글 기준), 자주 나오는 작품
  const stats = useMemo(() => {
    const stock = posts.filter((p) => p.category === '입고')
    const typeCount = Object.fromEntries(GOODS_TYPES.map((t) => [t, 0]))
    for (const p of stock) for (const t of p.goods_type) if (t in typeCount) typeCount[t]++
    const total = Object.values(typeCount).reduce((a, b) => a + b, 0)
    const types = GOODS_TYPES.filter((t) => typeCount[t] > 0)
      .sort((a, b) => typeCount[b] - typeCount[a])
      .map((t) => ({ t, pct: Math.round((typeCount[t] / total) * 100) }))
    const workCount = new Map()
    for (const p of posts) for (const w of p.works) workCount.set(w, (workCount.get(w) ?? 0) + 1)
    const works = [...workCount].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([w]) => w)
    return { types, works, count: posts.length }
  }, [posts])

  const photo = account.profile_image_path
    ? `${imageUrl(account.profile_image_path)}?v=${encodeURIComponent(account.profile_updated_at ?? '')}`
    : null

  return (
    <dialog
      ref={dialogRef}
      className="modal shop-modal"
      aria-labelledby="shop-title"
      onClose={onClose}
      onClick={(e) => e.target === dialogRef.current && onClose()}
    >
      <div className="shop-sheet">
        <button type="button" className="sheet-close" onClick={onClose} aria-label="닫기">
          ✕
        </button>

        <header className="shop-head">
          {photo ? <img className="shop-photo" src={photo} alt="" /> : <div className="shop-photo placeholder">{account.display_name[0]}</div>}
          <div className="shop-head-text">
            <h2 id="shop-title">
              {account.display_name}
              {onToggleFav && <FavButton on={fav} onToggle={onToggleFav} name={account.display_name} className="in-title" />}
            </h2>
            <a href={`https://www.instagram.com/${account.username}/`} target="_blank" rel="noopener noreferrer" className="shop-ig">
              @{account.username} ↗
            </a>
          </div>
        </header>

        {account.bio && <p className="shop-bio">{account.bio}</p>}
        {account.external_url && (
          <a className="shop-link" href={account.external_url} target="_blank" rel="noopener noreferrer">
            🔗 {account.external_url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}
          </a>
        )}

        {(stats.types.length > 0 || stats.works.length > 0) && (
          <section className="shop-stats">
            {stats.types.length > 0 && (
              <div className="stat-row">
                <span className="stat-label">취급</span>
                <span className="stat-value">{stats.types.map(({ t, pct }) => `${t} ${pct}%`).join(' · ')}</span>
              </div>
            )}
            {stats.works.length > 0 && (
              <div className="stat-row">
                <span className="stat-label">자주 나오는 작품</span>
                <div className="works">
                  {stats.works.map((w) => (
                    <span key={w} className="work">
                      {w}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        <section className="branch-list">
          {ordered.map((b, i) => (
            <BranchCard
              key={b.id ?? b.name}
              branch={b}
              shopName={account.display_name}
              multi={branches.length > 1}
              highlight={focused && focusBranches.includes(b.name)}
              defaultOpen={!focused || focusBranches.includes(b.name) || i === 0}
              now={now}
              link={account.external_url}
            />
          ))}
        </section>
      </div>
    </dialog>
  )
}

// 오프라인 매장이 없는 온라인 매장: 지점 지역을 "온라인"으로 둠 (관리자 매장 탭에서 지역에 "온라인")

function OnlineCard({ branch, link }) {
  return (
    <div className="branch-card">
      <div className="branch-head static">
        <span className="branch-name">🛒 온라인 매장</span>
        <span className="open-status online">오프라인 매장 없음</span>
      </div>
      <div className="branch-body">
        <p className="branch-addr muted">직접 찾아가는 매장이 없어요. 온라인 스토어나 인스타 DM으로 구매해요.</p>
        {link && (
          <div className="branch-actions">
            <a
              className="pill-btn online"
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => track('map_click', branch.account_username, { branch: ONLINE })}
            >
              온라인 스토어 바로가기
            </a>
          </div>
        )}
      </div>
    </div>
  )
}

function BranchCard({ branch, shopName, multi, highlight, defaultOpen, now, link }) {
  const [open, setOpen] = useState(defaultOpen)
  if (branch.region === ONLINE) return <OnlineCard branch={branch} link={link} />
  return <OfflineCard {...{ branch, shopName, multi, highlight, now, open, setOpen }} />
}

function OfflineCard({ branch, shopName, multi, highlight, now, open, setOpen }) {
  const [showHours, setShowHours] = useState(false)
  const status = openStatus(branch.hours, now)
  const lines = hoursLines(branch.hours)
  const today = todayName(now)

  return (
    <div className={`branch-card${highlight ? ' highlight' : ''}`}>
      <button type="button" className="branch-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="branch-name">
          📍 {multi ? branch.name : branch.naver_name || branch.name}
          {highlight && <span className="branch-tag">이 글의 지점</span>}
        </span>
        <span className={`open-status ${status.kind}`}>{status.text}</span>
      </button>

      {open && (
        <div className="branch-body">
          {branch.address ? <p className="branch-addr">{branch.address}</p> : <p className="branch-addr muted">주소 정보 없음</p>}
          {branch.directions && <p className="branch-dir">{branch.directions}</p>}

          <div className="branch-actions">
            <a
              className="pill-btn naver"
              href={mapUrl(branch, shopName)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => track('map_click', branch.account_username, { branch: branch.name })}
            >
              네이버 지도
            </a>
            {branch.phone && (
              <a
                className="pill-btn"
                href={`tel:${branch.phone.replace(/[^\d+]/g, '')}`}
                onClick={() => track('phone_click', branch.account_username, { branch: branch.name })}
              >
                📞 {branch.phone}
              </a>
            )}
          </div>

          {lines.length > 0 ? (
            <>
              <button type="button" className="toggle-btn" onClick={() => setShowHours((v) => !v)} aria-expanded={showHours}>
                <span>영업시간 {showHours ? '접기' : '보기'}</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points={showHours ? '18 15 12 9 6 15' : '6 9 12 15 18 9'} />
                </svg>
              </button>
              {showHours && (
                <ul className="hours">
                  {lines.map((l) => (
                    <li key={l.day} className={l.day === today ? 'today' : ''}>
                      <span>{l.day}</span>
                      <span>{l.text}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p className="branch-addr muted">영업시간 정보 없음 · 인스타에서 확인해 주세요</p>
          )}
          {branch.closed_regular && <p className="closed-note">정기 휴무: {branch.closed_regular}</p>}
          {branch.closed_coming?.length > 0 && <p className="closed-note">임시 휴무: {branch.closed_coming.join(', ')}</p>}
          {branch.hours_note && <p className="closed-note">{branch.hours_note}</p>}
        </div>
      )}
    </div>
  )
}
