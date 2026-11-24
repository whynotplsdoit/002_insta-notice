// 정렬
// - 일정순: 오늘(진행 중 포함, 남은 기간 짧은 순) → 앞으로 예정(가까운 순) → 지나간 것(최근에 끝난 순)
// - 최신순: 인스타에 올린 시각 최신순
//
// 글마다 날짜(시작~끝)를 정함
// - 본문에 날짜가 있으면 그 날짜 (입고일, 행사 기간)
// - 없으면 인스타에 올린 날 하루 (그날 입고·공지됐다고 봄)
// 날짜는 한국 시각 하루 단위로 비교 (오늘 0시 ~ 23:59)

const DAY = 86400000
const KST = 9 * 3600000

const dayStart = (ms) => Math.floor((ms + KST) / DAY) * DAY - KST
const dayEnd = (ms) => dayStart(ms) + DAY - 1

export const GROUPS = {
  today: '오늘 · 진행 중',
  upcoming: '앞으로 예정',
  past: '지난 소식',
}

export function scheduleOf(post, now = Date.now()) {
  const startMs = new Date(post.starts_at ?? post.posted_at).getTime()
  const endMs = post.ends_at ? new Date(post.ends_at).getTime() : startMs
  const start = dayStart(startMs)
  const end = dayEnd(Math.max(endMs, startMs))
  const group = now < start ? 'upcoming' : now > end ? 'past' : 'today'
  return { start, end, group }
}

const GROUP_ORDER = { today: 0, upcoming: 1, past: 2 }
const postedDesc = (a, b) => b.posted_at.localeCompare(a.posted_at)

export function sortBySchedule(posts, now = Date.now()) {
  return posts
    .map((p) => ({ p, s: scheduleOf(p, now) }))
    .sort((a, b) => {
      const g = GROUP_ORDER[a.s.group] - GROUP_ORDER[b.s.group]
      if (g) return g
      let d = 0
      if (a.s.group === 'today') d = a.s.end - b.s.end // 남은 기간 짧은 순
      else if (a.s.group === 'upcoming') d = a.s.start - b.s.start || a.s.end - b.s.end // 가까운 순
      else d = b.s.end - a.s.end // 최근에 끝난 순
      return d || postedDesc(a.p, b.p)
    })
    .map(({ p, s }) => ({ post: p, group: s.group }))
}

export function sortByPosted(posts) {
  return posts.slice().sort(postedDesc).map((p) => ({ post: p, group: null }))
}

// 카드에 붙일 일정 상태 (본문에 날짜가 있는 글만)
export function scheduleLabel(post, now = Date.now()) {
  if (!post.starts_at) return null
  const { start, end, group } = scheduleOf(post, now)
  const today = dayStart(now)
  if (group === 'upcoming') {
    const days = Math.round((start - today) / DAY)
    return { kind: 'upcoming', text: days === 1 ? '내일 시작' : `D-${days}` }
  }
  if (group === 'today') {
    const left = Math.round((dayStart(end) - today) / DAY)
    if (left === 0) return { kind: 'today', text: post.ends_at ? '오늘 마감' : '오늘' }
    return { kind: 'today', text: '진행 중' } // 언제까지인지는 바로 옆 날짜에 나옴
  }
  return { kind: 'past', text: '종료' }
}
