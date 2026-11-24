// 인스타그램에서 매장 게시물을 가져옵니다.
// 로그인된 브라우저 프로필로 계정 페이지를 열고, 페이지가 스스로 받아오는 데이터(JSON) 중에서 게시물을 골라냅니다.
import { chromium } from 'playwright'
import { PROFILE_DIR } from './profile.mjs'

export class LoginRequiredError extends Error {
  constructor() {
    super('인스타그램 로그인이 풀려 있습니다. npm run login 으로 다시 로그인하세요.')
  }
}

// --hidden 을 붙이면 창 없이 실행 (작업 스케줄러용)
export async function openBrowser({ headless = process.argv.includes('--hidden') } = {}) {
  return chromium.launchPersistentContext(PROFILE_DIR, {
    headless,
    viewport: { width: 1100, height: 900 },
    locale: 'ko-KR',
  })
}

// JSON 안을 전부 뒤져서 "게시물처럼 생긴" 객체(code + taken_at)를 찾습니다.
function collectPosts(value, found) {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (const v of value) collectPosts(v, found)
    return
  }
  if (typeof value.code === 'string' && typeof value.taken_at === 'number') {
    found.set(value.code, value)
  }
  for (const v of Object.values(value)) collectPosts(v, found)
}

// 사진 후보 중 가로 480px 이상인 것 중 가장 작은 것 (저장 용량 절약)
function pickImage(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null
  const sorted = [...candidates].sort((a, b) => (a.width ?? 0) - (b.width ?? 0))
  return (sorted.find((c) => (c.width ?? 0) >= 480) ?? sorted[sorted.length - 1]).url
}

function toPost(node) {
  return {
    code: node.code,
    url: `https://www.instagram.com/p/${node.code}/`,
    postedAt: new Date(node.taken_at * 1000).toISOString(),
    pinned: Array.isArray(node.timeline_pinned_user_ids) && node.timeline_pinned_user_ids.length > 0,
    type: node.media_type === 2 ? '동영상' : node.media_type === 8 ? '여러 장' : '사진',
    owner: node.user?.username ?? node.owner?.username ?? null,
    caption: node.caption?.text ?? '',
    imageUrl:
      pickImage(node.image_versions2?.candidates) ??
      pickImage(node.carousel_media?.[0]?.image_versions2?.candidates) ??
      null,
  }
}

// 매장 계정을 확인하고 부계정으로 팔로우합니다. (매장 추가 승인할 때 사용)
// 반환: { fullName, followed: 'new' | 'already' | 'failed' }
export async function followAccount(context, username) {
  const page = await context.newPage()
  try {
    const res = await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(5000)
    if (page.url().includes('/accounts/login')) throw new LoginRequiredError()
    if (res?.status() === 404) throw new Error('존재하지 않는 계정입니다.')
    // 제목 예: "시로상점 (@shirostore_hongdae) • Instagram 사진 및 동영상"
    const title = await page.title()
    const fullName = title.match(/^(.*?)\s*\(@/)?.[1]?.trim() || null
    // 비공개 계정은 팔로우 요청을 보내지 않고 중단 (글을 볼 수 없어서 수집 불가)
    if (await page.getByText(/비공개 (프로필|계정)입니다|This account is private/).count()) {
      throw new Error('비공개 계정이라 수집할 수 없습니다. 거절해 주세요.')
    }

    if (await page.getByRole('button', { name: /^(팔로잉|요청됨)$/ }).count()) return { fullName, followed: 'already' }
    const follow = page.getByRole('button', { name: /^(팔로우|맞팔로우 하기)$/ }).first()
    if (!(await follow.count())) return { fullName, followed: 'failed' }
    await follow.click()
    await page.waitForTimeout(3000)
    const ok = await page.getByRole('button', { name: /^(팔로잉|요청됨)$/ }).count()
    return { fullName, followed: ok ? 'new' : 'failed' }
  } finally {
    await page.close()
  }
}

// 팔로잉 피드(팔로우한 계정의 글만 시간순)에서 최근 글을 가져옵니다.
// 이미 아는 글(knownCodes)이 나올 때까지만 스크롤해서 요청을 최소화합니다.
export async function fetchFollowingFeed(context, knownCodes, { maxScrolls = 6 } = {}) {
  const page = await context.newPage()
  const found = new Map()
  page.on('response', async (res) => {
    const type = res.headers()['content-type'] ?? ''
    if (!type.includes('json') && !type.includes('javascript')) return
    try {
      const text = await res.text()
      if (!text.includes('taken_at')) return
      collectPosts(JSON.parse(text.replace(/^for \(;;\);/, '')), found)
    } catch {
      // 무시
    }
  })

  try {
    await page.goto('https://www.instagram.com/?variant=following', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(6000)
    if (page.url().includes('/accounts/login')) throw new LoginRequiredError()
    const html = await page.content()
    for (const m of html.matchAll(/<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/g)) {
      if (!m[1].includes('taken_at')) continue
      try {
        collectPosts(JSON.parse(m[1]), found)
      } catch {
        // 무시
      }
    }
    // 이미 아는 글이 2개 이상 보이면 그 아래는 다 아는 글이므로 멈춤
    for (let i = 0; i < maxScrolls; i++) {
      const knownSeen = [...found.keys()].filter((c) => knownCodes.has(c)).length
      if (knownSeen >= 2) break
      await page.mouse.wheel(0, 3000)
      await page.waitForTimeout(2000 + Math.random() * 1500)
    }
    return [...found.values()].map(toPost).sort((a, b) => b.postedAt.localeCompare(a.postedAt))
  } finally {
    await page.close()
  }
}

// JSON 안에서 이 계정의 프로필 정보(username + biography)를 찾음
function collectProfile(value, username, out) {
  if (!value || typeof value !== 'object' || out.found) return
  if (Array.isArray(value)) return value.forEach((v) => collectProfile(v, username, out))
  if (value.username === username && typeof value.biography === 'string') {
    out.found = {
      fullName: value.full_name || null,
      bio: value.biography || null,
      externalUrl: value.external_url || value.bio_links?.[0]?.url || null,
      profilePicUrl: value.hd_profile_pic_url_info?.url || value.profile_pic_url_hd || value.profile_pic_url || null,
    }
    return
  }
  for (const v of Object.values(value)) collectProfile(v, username, out)
}

// 한 매장의 최근 게시물(보통 12개)을 가져옵니다.
// 반환한 배열에 .profile (프로필 사진·이름·소개글·링크)이 붙어 있습니다. 못 찾으면 null.
export async function fetchAccount(context, username) {
  const page = await context.newPage()
  const found = new Map()
  const profile = { found: null }
  page.on('response', async (res) => {
    const type = res.headers()['content-type'] ?? ''
    if (!type.includes('json') && !type.includes('javascript')) return
    try {
      const text = await res.text()
      const hasPosts = text.includes('taken_at')
      const hasProfile = !profile.found && text.includes('"biography"')
      if (!hasPosts && !hasProfile) return
      const json = JSON.parse(text.replace(/^for \(;;\);/, ''))
      if (hasPosts) collectPosts(json, found)
      if (hasProfile) collectProfile(json, username, profile)
    } catch {
      // JSON이 아니거나 읽을 수 없는 응답은 무시
    }
  })

  try {
    await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(6000)
    if (page.url().includes('/accounts/login')) throw new LoginRequiredError()

    // 첫 화면 HTML 안에 들어 있는 데이터도 확인
    const html = await page.content()
    for (const m of html.matchAll(/<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/g)) {
      const hasPosts = m[1].includes('taken_at')
      const hasProfile = !profile.found && m[1].includes('"biography"')
      if (!hasPosts && !hasProfile) continue
      try {
        const json = JSON.parse(m[1])
        if (hasPosts) collectPosts(json, found)
        if (hasProfile) collectProfile(json, username, profile)
      } catch {
        // 무시
      }
    }

    const posts = [...found.values()]
      .map(toPost)
      .filter((p) => !p.owner || p.owner === username)
      .sort((a, b) => b.postedAt.localeCompare(a.postedAt))
    if (posts.length === 0) throw new Error('게시물을 찾지 못했습니다.')
    posts.profile = profile.found
    return posts
  } finally {
    await page.close()
  }
}
