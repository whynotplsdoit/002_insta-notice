// 매장 추가: 계정 확인 → 부계정 팔로우 → 첫 수집 → DB에 매장 추가
// 관리자 화면에서 승인된 신청(watch.mjs)과 명령(shops.mjs)에서 함께 씁니다.
import { fetchAccount, followAccount } from './instagram.mjs'
import { addAccount, savePosts, markCrawled } from './store.mjs'

// 최근 글의 절반 이상에 붙는 해시태그 = 매장이 늘 붙이는 고정 해시태그
export function detectFixedHashtags(posts) {
  if (posts.length < 3) return []
  const counts = new Map()
  for (const p of posts) {
    for (const tag of new Set([...(p.caption ?? '').matchAll(/#([^\s#]+)/g)].map((m) => m[1]))) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
  }
  return [...counts].filter(([, n]) => n >= Math.ceil(posts.length / 2)).map(([t]) => t)
}

// 반환: { account, followed, total, imagesUploaded }
export async function addShop(context, { username, displayName, region, accountType, intervalHours }, works) {
  const { fullName, followed } = await followAccount(context, username)
  const posts = await fetchAccount(context, username)
  const account = {
    username,
    displayName: displayName || fullName || username,
    accountType: accountType || '굿즈샵',
    fixedHashtags: detectFixedHashtags(posts),
    crawlIntervalHours: intervalHours ?? 6,
    branches: [{ name: region ? `${region}점` : '매장', aliases: [], region: region || null, address: null }],
  }
  await addAccount(account)
  const r = await savePosts(account, posts, works)
  await markCrawled(username)
  return { account, followed, total: r.total, imagesUploaded: r.imagesUploaded }
}
