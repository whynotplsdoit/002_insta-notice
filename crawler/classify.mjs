// 수집한 게시물을 분류합니다. (README "분류 규칙" 0~5단계)
// 입력: 매장 설정(config/accounts.json의 한 항목), 그 매장의 게시물 목록, 작품 사전
// 출력: 게시물마다 category, goodsType, works, branches, startsAt, endsAt, newTagCandidates

const BOILERPLATE_RATIO = 0.5 // 최근 글의 절반 이상에 들어 있는 줄은 반복 문구
const BOILERPLATE_MIN_POSTS = 5 // 글이 이보다 적으면 반복 문구를 찾지 않음

// 공백·기호를 빼고 소문자로 만든 비교용 문자열
const norm = (s) => s.toLowerCase().replace(/[\s·・.,!?~\-_'"’“”()[\]{}【】「」『』<>]/g, '')

// ---------- 0단계: 반복 문구 ----------
function splitLines(caption) {
  return caption
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
}

export function findBoilerplate(posts) {
  if (posts.length < BOILERPLATE_MIN_POSTS) return new Set()
  const counts = new Map()
  for (const p of posts) {
    for (const line of new Set(splitLines(p.caption).map(norm))) {
      if (line.length < 4) continue // 너무 짧은 줄(이모지 등)은 제외
      counts.set(line, (counts.get(line) ?? 0) + 1)
    }
  }
  const limit = Math.ceil(posts.length * BOILERPLATE_RATIO)
  return new Set([...counts].filter(([, n]) => n >= limit).map(([line]) => line))
}

function stripBoilerplate(caption, boilerplate) {
  return splitLines(caption)
    .filter((line) => !boilerplate.has(norm(line)))
    .join('\n')
}

// ---------- 1단계: 분류 ----------
const COLLAB_WORDS = ['콜라보', '팝업스토어', 'pop-up', 'popup', '팝업']
const KUJI_WORDS = ['쿠지', '이치방쿠지', '제일복권', '아타리복권', '一番くじ']
const GACHA_WORDS = ['가챠', '캡슐']
const FIGURE_WORDS = ['피규어', '룩업', '메가캣', 'lookup']
// 제목에 있으면 이벤트·안내로 볼 단어 ("안내"는 "입고안내", "POP-UP 안내"에도 쓰여서 제외)
const TITLE_EVENT_WORDS = ['이벤트', '할인', '휴무', '공지', '사과', '정식 오픈', '영업시간']
const BODY_EVENT_WORDS = ['이벤트', '할인', '휴무', '영업시간', '공지', '안내', '사과', '교환', '예약']
const STORE_INTRO_WORDS = ['📍', '위치', '주소', '포토존']

const hasAny = (text, words) => {
  const t = text.toLowerCase()
  return words.some((w) => t.includes(w.toLowerCase()))
}

// 해시태그를 뺀 본문 (#홍대피규어샵 때문에 "피규어"로 잘못 잡히는 것 방지)
const withoutHashtags = (text) => text.replace(/#[^\s#]+/g, ' ')

// 제목: 한글이 2글자 이상 들어 있는 첫 줄 (". " 이나 이모지만 있는 줄은 건너뜀)
function titleOf(body) {
  return splitLines(withoutHashtags(body)).find((l) => (l.match(/[가-힣]/g) ?? []).length >= 2) ?? ''
}

// 매장 고정 해시태그와 "○○샵" 같은 매장 소개 태그를 뺀 해시태그 (#제일복권 같은 정보는 남김)
function meaningfulTags(caption, account) {
  const fixed = new Set((account.fixedHashtags ?? []).map(norm))
  return hashtags(caption).filter((t) => !fixed.has(norm(t)) && !/샵|맛집|투어/.test(t))
}

function classifyCategory(post, account, body) {
  const text = withoutHashtags(body)
  // 제목은 원문에서 읽음 ("[ 유미상점 입고 소식 ]"처럼 매번 같은 제목 줄이 반복 문구로 지워지는 것 방지)
  const title = titleOf(post.caption ?? '')
  const isCollabAccount = account.accountType === '콜라보카페'

  // 고정 글인데 제목에 "입고"가 없으면 매장 공지 (예: "시로가챠입니다", 매장 소개)
  if (post.pinned && !title.includes('입고')) {
    return hasAny(title, COLLAB_WORDS) ? '콜라보·팝업' : '이벤트·안내'
  }
  // 제목을 먼저 봅니다
  if (title.includes('입고')) return '입고'
  if (hasAny(title, COLLAB_WORDS)) return '콜라보·팝업'
  if (!isCollabAccount && hasAny(title, [...KUJI_WORDS, ...GACHA_WORDS])) return '입고'
  if (hasAny(title, TITLE_EVENT_WORDS)) return '이벤트·안내'
  if (isCollabAccount) return '콜라보·팝업'
  // 해시태그에 쿠지·가챠가 있으면 입고 (예: "⭐나루토 질풍전⭐ … #제일복권")
  if (hasAny(meaningfulTags(post.caption ?? '', account).join(' '), [...KUJI_WORDS, ...GACHA_WORDS])) return '입고'
  // 제목으로 판단이 안 되면 본문 전체
  if (text.includes('정식 오픈')) return '이벤트·안내'
  if (text.includes('입고')) return '입고'
  if (hasAny(text, COLLAB_WORDS)) return '콜라보·팝업'
  if (post.pinned || hasAny(text, BODY_EVENT_WORDS)) return '이벤트·안내'
  // 상품 목록만 있는 글 (토이아일랜드: "⭐️ 룩업 귀멸의칼날 이노스케 ⭐️ ...")
  if (hasAny(text, [...KUJI_WORDS, ...GACHA_WORDS, ...FIGURE_WORDS])) return '입고'
  return '기타'
}

// ---------- 2단계: 상품 종류 ----------
function detectTypes(text) {
  const types = []
  if (hasAny(text, KUJI_WORDS)) types.push('쿠지')
  if (hasAny(text, GACHA_WORDS)) types.push('가챠')
  if (hasAny(text, FIGURE_WORDS)) types.push('피규어')
  return types
}

function classifyGoodsType(body, caption, account) {
  // 1) 제목에 종류가 적혀 있으면 그대로 따름 ("⭐은혼 굿즈 입고!⭐", "🫧캡슐 가챠 입고🫧")
  const title = titleOf(caption)
  const fromTitle = detectTypes(title)
  if (/굿즈\s*(&|입고)/.test(title) || /굿즈$/.test(title.replace(/[^가-힣]+$/, ''))) fromTitle.push('굿즈')
  if (fromTitle.length) return [...new Set(fromTitle)]
  // 2) 없으면 본문 + 의미 있는 해시태그
  const types = detectTypes(withoutHashtags(body) + ' ' + meaningfulTags(caption, account).join(' '))
  return types.length ? types : ['굿즈']
}

// ---------- 3단계: 작품 ----------
function hashtags(text) {
  return [...text.matchAll(/#([^\s#]+)/g)].map((m) => m[1])
}

function findWorks(body, caption, account, works) {
  // 본문(해시태그 제외)에서 먼저 찾고, 매장 고정 해시태그를 뺀 해시태그로 보충
  const fixed = new Set((account.fixedHashtags ?? []).map(norm))
  const tags = hashtags(caption).filter((t) => !fixed.has(norm(t)))
  const bodyText = norm(body.replace(/#[^\s#]+/g, ' '))
  const tagTexts = tags.map(norm)

  const found = []
  for (const work of works) {
    const aliases = work.aliases.map(norm)
    const inBody = aliases.some((a) => bodyText.includes(a))
    const inTags = aliases.some((a) => tagTexts.some((t) => t === a || t.includes(a)))
    if (inBody || inTags) found.push(work.name)
  }

  // 사전에 없는 해시태그 → 새 작품 후보 (나중에 사전에 추가할지 직접 판단)
  const known = works.flatMap((w) => w.aliases.map(norm))
  const generic = ['굿즈', '굿즈샵', '피규어', '가챠', '쿠지', '입고', '신상', '홍대']
  const newTagCandidates = tags.filter((t) => {
    const n = norm(t)
    return !known.some((a) => n.includes(a)) && !generic.some((g) => n.includes(g))
  })
  return { works: found, newTagCandidates }
}

// ---------- 4단계: 지점 ----------
function findBranches(caption, account) {
  const branches = account.branches ?? []
  if (branches.length <= 1) return branches.map((b) => b.name)
  const text = caption.replace(/\s+/g, ' ')
  const matched = branches.filter((b) => (b.aliases ?? []).some((a) => text.includes(a)))
  return (matched.length ? matched : branches).map((b) => b.name)
}

// ---------- 5단계: 일시 ----------
// "10월 25일 (일요일) 오후 2시", "11.21(토)", "26년 9월 5일", "12월18일(금)~1월19일(화)"
const DATE_RE =
  /(?:(\d{2,4})\s*년\s*)?(\d{1,2})\s*(?:월\s*|[./]\s*)(\d{1,2})\s*일?\s*(?:\([^)]{1,4}\))?\s*(?:(오전|오후)\s*)?(?:(\d{1,2})\s*(?:시|:\s*(\d{2})))?/g

function toDate(match, postedAt) {
  const [, y, mo, d, ampm, h, mi] = match
  const month = Number(mo)
  const day = Number(d)
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const posted = new Date(postedAt)
  let year = y ? (y.length === 2 ? 2000 + Number(y) : Number(y)) : posted.getFullYear()
  let hour = h ? Number(h) : 0
  if (ampm === '오후' && hour < 12) hour += 12
  // 한국 시각 기준으로 만들기 (UTC+9)
  let date = new Date(Date.UTC(year, month - 1, day, hour - 9, mi ? Number(mi) : 0))
  // 연도가 없고 올린 날짜보다 60일 넘게 과거면 다음 해로 판단 (12월 글의 1월 날짜)
  if (!y && date < new Date(posted.getTime() - 60 * 86400000)) {
    year += 1
    date = new Date(Date.UTC(year, month - 1, day, hour - 9, mi ? Number(mi) : 0))
  }
  return date
}

function findDates(body, postedAt) {
  // 숫자 뒤에 "개", "종" 등이 붙은 상품 수량은 날짜로 보지 않도록, 월/일 표기가 있는 것만
  const dates = []
  for (const m of body.matchAll(DATE_RE)) {
    const raw = m[0]
    const isDate = /월/.test(raw) || /^\d{1,2}[./]\d{1,2}\s*\(/.test(raw.trim())
    if (!isDate) continue
    const date = toDate(m, postedAt)
    if (date) dates.push({ date, index: m.index, raw: raw.trim() })
  }
  if (dates.length === 0) return { startsAt: null, endsAt: null }

  // "A ~ B" 형태면 기간
  for (let i = 0; i < dates.length - 1; i++) {
    const between = body.slice(dates[i].index + dates[i].raw.length, dates[i + 1].index)
    if (/^\s*[~〜\-–]\s*$/.test(between)) {
      return { startsAt: dates[i].date.toISOString(), endsAt: dates[i + 1].date.toISOString() }
    }
  }
  // "시작", "스타트", "개최", "일정" 근처의 날짜를 시작 일시로
  const keyword = /(시작|스타트|개최|일정|기간|진행)/
  const near = dates.find((d) => keyword.test(body.slice(Math.max(0, d.index - 15), d.index + d.raw.length + 10)))
  return { startsAt: (near ?? dates[0]).date.toISOString(), endsAt: null }
}

// ---------- 욕설·비방 ----------
// 욕설·비방 글: 사이트에 올리지 않고(숨김) 관리자 '기타 검토'로 보냄. 나머지 기타 글은 검토 없이 바로 게시
// "미친 가격"처럼 홍보에도 쓰는 말은 넣지 않음 (잘못 걸리면 좋은 글이 숨겨지므로 확실한 욕만)
const ABUSE_RE =
  /씨\s*발|시\s*발(?![점역])|씌발|ㅅㅂ|ㅆㅂ|병\s*신|ㅄ|좆|존\s*나|졸\s*라|개\s*새\s*끼|새끼야|지\s*랄|ㅈㄹ|미친\s*(놈|년|새끼)|꺼져|닥쳐|엿\s*먹|느\s*금|니\s*애미|애미\s*(없|뒤)|썅|fuck|shit|bitch|사기꾼|쓰레기\s*(같|들)/i
export function isAbusive(caption) {
  return ABUSE_RE.test(caption ?? '')
}

// ---------- 전체 ----------
// abusive(욕설·비방 → 숨기고 검토)를 함께 돌려줌. 본문 없는 글도 그대로 분류 (대부분 '기타')
export function classifyPosts(account, posts, works) {
  const boilerplate = findBoilerplate(posts)
  return posts.map((post) => {
    const body = stripBoilerplate(post.caption ?? '', boilerplate)
    const category = classifyCategory(post, account, body)
    const { works: foundWorks, newTagCandidates } = findWorks(body, post.caption ?? '', account, works)
    const { startsAt, endsAt } =
      category === '기타' ? { startsAt: null, endsAt: null } : findDates(body, post.postedAt)
    return {
      ...post,
      category,
      goodsType: category === '입고' ? classifyGoodsType(body, post.caption ?? '', account) : [],
      works: foundWorks,
      branches: findBranches(post.caption ?? '', account),
      startsAt,
      endsAt,
      newTagCandidates,
      abusive: isAbusive(post.caption),
    }
  })
}
