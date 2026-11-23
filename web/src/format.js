// 날짜·글 표시 도우미
const TZ = 'Asia/Seoul'

export function timeAgo(iso, now = Date.now()) {
  const diff = Math.max(0, now - new Date(iso).getTime())
  const min = Math.floor(diff / 60000)
  if (min < 1) return '방금'
  if (min < 60) return `${min}분 전`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour}시간 전`
  const day = Math.floor(hour / 24)
  if (day < 7) return `${day}일 전`
  return new Date(iso).toLocaleDateString('ko-KR', { timeZone: TZ, month: 'numeric', day: 'numeric' })
}

// 한국 시각 기준 "11.19(수)" 또는 "11.19(수) 14:00" (시각이 00:00이면 날짜만)
function kst(iso) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('ko-KR', {
      timeZone: TZ,
      month: 'numeric',
      day: 'numeric',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  )
  const date = `${parts.month}.${parts.day}(${parts.weekday})`
  const time = `${parts.hour}:${parts.minute}`
  return time === '00:00' ? date : `${date} ${time}`
}

export function dateRange(startsAt, endsAt) {
  if (!startsAt) return null
  return endsAt ? `${kst(startsAt)} ~ ${kst(endsAt)}` : kst(startsAt)
}

const linesOf = (caption) =>
  (caption ?? '')
    .replace(/#[^\s#]+/g, ' ')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

const hasHangul = (l) => (l.match(/[가-힣]/g) ?? []).length >= 2

// 매번 똑같이 쓰는 머리말 ("[ 시로가챠 입고안내 ]", "[ 유미상점 입고 소식 ]") → 내용이 없으니 제목에서 제외
const isGenericHeading = (l) => /^[[【(<].{0,20}(입고\s*안내|입고\s*소식|입고안내)\s*[\]】)>]$/.test(l)

// 제목: 한글이 2글자 이상인 첫 줄 (고정 머리말은 건너뜀)
export function titleOf(caption) {
  const lines = linesOf(caption)
  const meaningful = lines.filter(hasHangul)
  return meaningful.find((l) => !isGenericHeading(l)) ?? meaningful[0] ?? lines[0] ?? ''
}

// 글자나 숫자가 하나도 없는 줄 (".", "•*¨*•.¸¸☆*" 같은 꾸밈 줄)
const isDecoration = (l) => !/[\p{L}\p{N}]/u.test(l)

// 본문: 제목 줄과 고정 머리말, 꾸밈 줄, 해시태그를 뺀 나머지
export function bodyOf(caption, title) {
  return linesOf(caption)
    .filter((l) => l !== title && !isGenericHeading(l) && !isDecoration(l))
    .join('\n')
}
