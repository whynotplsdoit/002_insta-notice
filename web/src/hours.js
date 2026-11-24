// 영업시간 계산 (한국 시각 기준)
// hours: [{ day: '월', start: '11:00', end: '20:00', breaks: ['15:00-16:00'], note }]
const DAYS = ['일', '월', '화', '수', '목', '금', '토']
export const WEEK_ORDER = ['월', '화', '수', '목', '금', '토', '일']

const toMin = (hhmm) => {
  if (!hhmm) return null
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + (m || 0)
}

// 한국 시각의 요일·분
function kstNow(now = Date.now()) {
  const d = new Date(now + 9 * 3600000)
  return { day: DAYS[d.getUTCDay()], prevDay: DAYS[(d.getUTCDay() + 6) % 7], min: d.getUTCHours() * 60 + d.getUTCMinutes() }
}

const entryOf = (hours, day) => hours.find((h) => h.day === day)

// 반환: { kind: 'open' | 'before' | 'closed' | 'off' | 'unknown', text }
export function openStatus(hours, now = Date.now()) {
  if (!Array.isArray(hours) || hours.length === 0) return { kind: 'unknown', text: '영업시간 정보 없음' }
  const { day, prevDay, min } = kstNow(now)

  // 전날 영업이 자정을 넘겨 이어지는 경우 (예: 18:00~02:00)
  const prev = entryOf(hours, prevDay)
  if (prev?.start && prev?.end && toMin(prev.end) < toMin(prev.start) && min < toMin(prev.end)) {
    return { kind: 'open', text: `영업 중 · ${prev.end}까지` }
  }

  const today = entryOf(hours, day)
  if (!today || !today.start || !today.end) return { kind: 'off', text: '오늘 휴무' }
  const s = toMin(today.start)
  let e = toMin(today.end)
  if (e <= s) e += 24 * 60 // 자정 넘김
  if (min < s) return { kind: 'before', text: `영업 전 · ${today.start} 시작` }
  if (min >= e) return { kind: 'closed', text: '오늘 영업 종료' }
  for (const b of today.breaks ?? []) {
    const [bs, be] = b.split('-').map(toMin)
    if (bs != null && be != null && min >= bs && min < be) return { kind: 'before', text: `휴게 시간 · ${b.split('-')[1]} 다시 영업` }
  }
  return { kind: 'open', text: `영업 중 · ${today.end}까지` }
}

// 요일별 표시 줄 ["월 11:00 – 20:00", ...], 같은 시간이 이어지면 묶지 않고 요일 순서대로
export function hoursLines(hours) {
  if (!Array.isArray(hours)) return []
  return WEEK_ORDER.map((day) => {
    const h = entryOf(hours, day)
    if (!h || !h.start) return { day, text: '휴무' }
    const extra = [h.breaks?.length ? `휴게 ${h.breaks.join(', ')}` : null, h.note].filter(Boolean).join(' · ')
    return { day, text: `${h.start} – ${h.end}${extra ? ` (${extra})` : ''}` }
  })
}

export const todayName = (now = Date.now()) => kstNow(now).day
