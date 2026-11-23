// 관리자 화면 도우미
export const fmtTime = (iso) =>
  iso
    ? new Date(iso).toLocaleString('ko-KR', {
        timeZone: 'Asia/Seoul',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '-'

export function ago(iso) {
  if (!iso) return '기록 없음'
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (min < 1) return '방금'
  if (min < 60) return `${min}분 전`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}시간 전`
  return `${Math.floor(h / 24)}일 전`
}

// "a, b,c" ↔ ['a','b','c']
export const toList = (text) =>
  text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
export const fromList = (list) => (list ?? []).join(', ')

// ISO ↔ 한국 날짜 "2026-11-23" (input type=date 용)
export const toKstDate = (iso) =>
  iso ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(iso)) : ''
export const fromKstDate = (d) => (d ? new Date(`${d}T00:00:00+09:00`).toISOString() : null)

export const CATEGORIES = ['입고', '콜라보·팝업', '이벤트·안내', '기타']
export const GOODS_TYPES = ['쿠지', '가챠', '피규어', '굿즈']
export const ACCOUNT_TYPES = ['굿즈샵', '콜라보카페']
