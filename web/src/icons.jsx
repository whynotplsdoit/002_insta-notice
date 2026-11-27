// 아래 탭 아이콘 (단색 선 아이콘, 글자색을 그대로 따라감)
const base = {
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
}

// 필터: 슬라이더
export const SlidersIcon = () => (
  <svg {...base}>
    <path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" />
    <circle cx="15" cy="6" r="2" />
    <circle cx="9" cy="12" r="2" />
    <circle cx="17" cy="18" r="2" />
  </svg>
)

// 검색: 돋보기
export const SearchIcon = () => (
  <svg {...base}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4 4" />
  </svg>
)

// 전체: 레이더
export const RadarIcon = () => (
  <svg {...base}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <path d="M12 12l5.5-5.5" />
    <circle cx="12" cy="12" r="1" fill="currentColor" />
  </svg>
)

// 입고: 상자
export const BoxIcon = () => (
  <svg {...base}>
    <path d="M3.5 7.5L12 3l8.5 4.5v9L12 21l-8.5-4.5z" />
    <path d="M3.5 7.5L12 12l8.5-4.5" />
    <path d="M12 12v9" />
    <path d="M7.75 5.25l8.5 4.5" />
  </svg>
)

// 콜라보·팝업: 가게
export const StoreIcon = () => (
  <svg {...base}>
    <path d="M4 9.5V20h16V9.5" />
    <path d="M3 9.5L5 4h14l2 5.5c0 1.4-1.1 2.5-2.5 2.5S16 10.9 16 9.5c0 1.4-1.1 2.5-2.5 2.5h-3C9.1 12 8 10.9 8 9.5 8 10.9 6.9 12 5.5 12S3 10.9 3 9.5z" />
    <path d="M10 20v-4.5h4V20" />
  </svg>
)

// 지도: 지도 핀
export const MapPinIcon = () => (
  <svg {...base}>
    <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
    <circle cx="12" cy="10" r="2.4" />
  </svg>
)

// 이벤트·안내: 확성기
export const MegaphoneIcon = () => (
  <svg {...base}>
    <path d="M4 10v4a1 1 0 0 0 1 1h2l8 4.5V4.5L7 9H5a1 1 0 0 0-1 1z" />
    <path d="M7 15l1.5 5" />
    <path d="M18.5 9a4 4 0 0 1 0 6" />
  </svg>
)

// 단골 매장: 하트 (빈 하트 → 추가하면 채운 하트). 크기는 글자 크기(1em)를 따라감
export const HeartIcon = ({ filled = false }) => (
  <svg {...base} width="1em" height="1em" className="ico-heart" fill={filled ? 'currentColor' : 'none'}>
    <path d="M12 20.3s-7.8-4.7-7.8-10.4A4.4 4.4 0 0 1 12 7.2a4.4 4.4 0 0 1 7.8 2.7c0 5.7-7.8 10.4-7.8 10.4z" />
  </svg>
)
