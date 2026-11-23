// 여러 매장을 매장 페이지에서 직접 수집해서 DB에 저장합니다. (수동 실행용, 자동 수집은 watch.mjs)
//
// 사용법
//   npm run crawl                    수집할 때가 된 매장만 (한국 시각 10~22시에만 동작)
//   npm run crawl -- --all           시간·간격 무시하고 전체 매장
//   npm run crawl -- kuji.run        특정 매장만 (여러 개 가능)
//   --no-wait                        매장 사이 1~3분 쉬는 것 생략 (시험용)
import { openBrowser, fetchAccount, LoginRequiredError } from './instagram.mjs'
import { loadConfig, savePosts, markCrawled } from './store.mjs'
import { log } from './log.mjs'

const ACTIVE_HOURS = [10, 22] // 한국 시각, 이 시간에만 자동 수집
const WAIT_MIN_MS = 60_000
const WAIT_MAX_MS = 180_000

const args = process.argv.slice(2)
const force = args.includes('--all')
const noWait = args.includes('--no-wait')
const only = args.filter((a) => !a.startsWith('--'))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const koreaHour = () => Number(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul', hour: 'numeric', hour12: false }))

const config = await loadConfig()
const active = config.accounts.filter((a) => !a.hidden) // 숨긴 매장은 수집하지 않음

// 수집할 매장 고르기
let targets
if (only.length) {
  targets = config.accounts.filter((a) => only.includes(a.username))
  const unknown = only.filter((u) => !targets.some((a) => a.username === u))
  if (unknown.length) console.log(`등록되지 않은 매장: ${unknown.join(', ')}`)
} else if (force) {
  targets = active
} else {
  const hour = koreaHour()
  if (hour < ACTIVE_HOURS[0] || hour >= ACTIVE_HOURS[1]) {
    console.log(`지금은 ${hour}시라 수집하지 않습니다. (${ACTIVE_HOURS[0]}~${ACTIVE_HOURS[1]}시에만 수집)`)
    process.exit(0)
  }
  const now = Date.now()
  targets = active.filter((a) => {
    const t = a.lastCrawledAt
    // 10분 여유: 1시간마다 깨어날 때 몇 분 차이로 한 번 건너뛰는 것 방지
    return !t || now - new Date(t).getTime() >= a.crawlIntervalHours * 3600_000 - 10 * 60_000
  })
}

if (targets.length === 0) {
  console.log('지금 수집할 매장이 없습니다.')
  process.exit(0)
}

// 매번 같은 순서로 접속하지 않도록 섞기
targets = targets.sort(() => Math.random() - 0.5)
await log(`수집 시작: ${targets.map((a) => a.displayName).join(', ')}`)

const context = await openBrowser()
let failed = 0
try {
  for (const [i, account] of targets.entries()) {
    try {
      const posts = await fetchAccount(context, account.username)
      const r = await savePosts(account, posts, config.works)
      await markCrawled(account.username)
      await log(`✓ ${account.displayName}: 글 ${r.total}개, 새 글 ${r.added}개, 사진 ${r.imagesUploaded}장`)
      if (r.added === r.total && r.total >= 12) {
        await log(`  ⚠ ${account.displayName}: 가져온 글이 전부 새 글입니다. 놓친 글이 있을 수 있으니 수집 간격을 줄이세요.`)
      }
    } catch (err) {
      if (err instanceof LoginRequiredError) {
        await log(`✗ ${err.message}`, { level: 'error' })
        failed = targets.length
        break
      }
      failed++
      await log(`✗ ${account.displayName}: ${err.message}`, { level: 'error', account: account.username })
    }
    if (!noWait && i < targets.length - 1) {
      await sleep(WAIT_MIN_MS + Math.random() * (WAIT_MAX_MS - WAIT_MIN_MS))
    }
  }
} finally {
  await context.close()
}

await log(`수집 끝: 성공 ${targets.length - failed}곳, 실패 ${failed}곳`)
process.exitCode = failed ? 1 : 0
