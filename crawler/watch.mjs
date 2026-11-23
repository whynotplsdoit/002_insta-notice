// 팔로잉 피드로 새 글을 감시합니다. (작업 스케줄러가 15분마다 실행할 파일)
//
// 1) 관리자 화면에서 승인된 매장 신청이 있으면 매장 추가 (팔로우 → 첫 수집)
// 2) 팔로잉 피드 한 페이지만 열어서 매장들의 새 글이 있는지 확인
// 3) 새 글이 있는 매장만 매장 페이지를 열어 정확히 수집·분류·저장
// 4) 피드에서 놓쳤을 수 있으니, 오래 수집하지 않은 매장 1곳은 매번 직접 확인
//
// 사용법
//   npm run watch            한국 시각 9시~24시에만 동작
//   npm run watch -- --now   시간 상관없이 바로 실행 (시험용)
//   --hidden                 브라우저 창 없이 실행 (작업 스케줄러용)
import { db } from './db.mjs'
import { openBrowser, fetchAccount, fetchFollowingFeed, LoginRequiredError } from './instagram.mjs'
import { loadConfig, savePosts, markCrawled } from './store.mjs'
import { addShop } from './add-shop.mjs'
import { log } from './log.mjs'

const ACTIVE_HOURS = [9, 24] // 한국 시각
const SAFETY_HOURS = 24 // 이 시간 넘게 직접 확인하지 않은 매장은 피드와 별개로 확인
const START_JITTER_MS = 90_000 // 매번 정각에 접속하지 않도록 0~1.5분 무작위 대기

const args = process.argv.slice(2)
const now = args.includes('--now')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pause = () => sleep(20_000 + Math.random() * 40_000) // 페이지 사이 20~60초
const koreaHour = () => Number(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul', hour: 'numeric', hour12: false }))

if (!now) {
  const hour = koreaHour()
  if (hour < ACTIVE_HOURS[0] || hour >= ACTIVE_HOURS[1]) {
    console.log(`지금은 ${hour}시라 확인하지 않습니다. (${ACTIVE_HOURS[0]}~${ACTIVE_HOURS[1]}시에만)`)
    process.exit(0)
  }
  await sleep(Math.random() * START_JITTER_MS)
}

const config = await loadConfig()
const active = config.accounts.filter((a) => !a.hidden) // 숨긴 매장은 수집하지 않음
const byUsername = new Map(active.map((a) => [a.username, a]))

const { data: recent, error } = await db.from('posts').select('code').order('posted_at', { ascending: false }).limit(500)
if (error) throw new Error(error.message)
const known = new Set(recent.map((r) => r.code))

const { data: approved } = await db.from('shop_requests').select('*').eq('status', 'approved').order('created_at')

const context = await openBrowser()
let failed = 0
try {
  // 1) 승인된 매장 추가
  for (const req of approved ?? []) {
    try {
      if (config.accounts.some((a) => a.username === req.username)) throw new Error('이미 등록된 매장입니다.')
      const r = await addShop(
        context,
        { username: req.username, displayName: req.display_name, region: req.region, accountType: req.account_type },
        config.works,
      )
      const msg = `${r.account.displayName} 추가 완료: 글 ${r.total}개, 사진 ${r.imagesUploaded}장${r.followed === 'failed' ? ' (⚠ 팔로우 실패: 부계정으로 직접 팔로우 필요)' : ''}`
      await db.from('shop_requests').update({ status: 'done', result: msg }).eq('id', req.id)
      await log(`🏪 ${msg}`, { account: req.username })
    } catch (err) {
      if (err instanceof LoginRequiredError) throw err
      await db.from('shop_requests').update({ status: 'failed', result: err.message }).eq('id', req.id)
      await log(`✗ 매장 추가 실패 @${req.username}: ${err.message}`, { level: 'error', account: req.username })
    }
    await pause()
  }

  // 2) 팔로잉 피드
  const feed = await fetchFollowingFeed(context, known)
  const fresh = feed.filter((p) => byUsername.has(p.owner) && !known.has(p.code))
  const targets = [...new Set(fresh.map((p) => p.owner))]
  await log(
    `피드 확인: 글 ${feed.length}개 중 새 글 ${fresh.length}개` +
      (targets.length ? ` (${targets.map((u) => byUsername.get(u).displayName).join(', ')})` : ''),
  )

  // 4) 오래 확인하지 않은 매장 1곳 추가
  const stale = active
    .filter((a) => !targets.includes(a.username))
    .filter((a) => !a.lastCrawledAt || Date.now() - new Date(a.lastCrawledAt).getTime() > SAFETY_HOURS * 3600_000)
    .sort((a, b) => (a.lastCrawledAt ?? '').localeCompare(b.lastCrawledAt ?? ''))[0]
  if (stale) targets.push(stale.username)

  // 3) 매장 페이지에서 정확히 수집
  for (const username of targets) {
    const account = byUsername.get(username)
    await pause()
    try {
      const posts = await fetchAccount(context, username)
      const r = await savePosts(account, posts, config.works)
      await markCrawled(username)
      const why = stale?.username === username ? ' (정기 확인)' : ''
      await log(`✓ ${account.displayName}${why}: 새 글 ${r.added}개, 사진 ${r.imagesUploaded}장`, { account: username })
    } catch (err) {
      if (err instanceof LoginRequiredError) throw err
      failed++
      await log(`✗ ${account.displayName}: ${err.message}`, { level: 'error', account: username })
    }
  }
} catch (err) {
  failed++
  await log(`✗ ${err.message}`, { level: 'error' })
} finally {
  await context.close()
}
process.exitCode = failed ? 1 : 0
