// 즐겨찾기 매장: 로그인 없이 이 브라우저에만 저장 (기기마다 따로)
// 예전 필터의 "고른 매장"이 있으면 처음 한 번 즐겨찾기로 옮김
import { HeartIcon } from './icons.jsx'
import { useCallback, useEffect, useState } from 'react'

const KEY = 'goods-radar:favorites'
const OLD_FILTERS = 'goods-feed:filters:v2'

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY))
    if (Array.isArray(saved)) return saved
    const old = JSON.parse(localStorage.getItem(OLD_FILTERS))?.shops
    return Array.isArray(old) ? old : []
  } catch {
    return []
  }
}

// 반환: { favorites: 아이디 배열, isFav(username), toggleFav(username) → 이제 즐겨찾기면 true }
export function useFavorites() {
  const [favorites, setFavorites] = useState(load)

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(favorites))
    } catch {
      // 저장 못 해도 이번 방문 동안은 동작
    }
  }, [favorites])

  const isFav = useCallback((u) => favorites.includes(u), [favorites])
  const toggleFav = useCallback(
    (u) => {
      const on = !favorites.includes(u)
      setFavorites((list) => (on ? [...list.filter((x) => x !== u), u] : list.filter((x) => x !== u)))
      return on
    },
    [favorites],
  )
  return { favorites, isFav, toggleFav }
}

// 단골 매장 버튼 (빈 하트 → 누르면 채운 하트)
export function FavButton({ on, onToggle, name, className = '' }) {
  return (
    <button
      type="button"
      className={`fav-btn${on ? ' on' : ''} ${className}`}
      aria-pressed={on}
      aria-label={on ? `${name} 단골 매장 해제` : `${name} 단골 매장 추가`}
      title={on ? '단골 매장 해제' : '단골 매장 추가'}
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
    >
      <HeartIcon filled={on} />
    </button>
  )
}
