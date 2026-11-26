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
import { loadConfig, savePosts, saveProfile, markCrawled } from './store.mjs'
import { syncNaver } from './naver-sync.mjs'
import { notifyAdmin } from './notify.mjs'
import { addShop } from './add-shop.mjs'
import { reviewRequest, autoAddedToday, AUTO_ADD_PER_DAY } from './review-request.mjs'
import { openNaverBrowser } from './naver.mjs'
import { log } from './log.mjs'
import { NETWORK_ERR, retryNetwork, shortError } from './retry.mjs'
import { cleanupRecords, deleteExpiredPosts, hasNoCaption, loadDeletedCodes, summarize } from './cleanup.mjs'

const ACTIVE_HOURS = [9, 24] // 한국 시각
const SAFETY_HOURS = 24 // 이 시간 넘게 직접 확인하지 않은 매장은 피드와 별개로 확인
const START_JITTER_MS = 90_000 // 매번 정각에 접속하지 않도록 0~1.5분 무작위 대기

const args = process.argv.slice(2)
const now = args.includes('--now')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pause = () => sleep(20_000 + Math.random() * 40_000) // 페이지 사이 20~60초
const koreaHour = () => Number(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul', hour: 'numeric', hour12: false }))

// 0) 오래된 글 삭제: DB만 정리하고 인스타에 접속하지 않으므로 시간과 상관없이 매번 (규칙은 cleanup.mjs)
try {
  const removed = await deleteExpiredPosts()
  if (removed.length) await log(`🗑 오래된 글 ${removed.length}개 삭제 (${summarize(removed)})`)
  const rec = await cleanupRecords()
  if (rec.logs || rec.records || rec.requests)
    console.log(`기록 정리: 수집 기록 ${rec.logs}줄, 삭제 기록 ${rec.records}개, 처리된 매장 신청 ${rec.requests}건, 스팸 의견 ${rec.spam}건`)
} catch (err) {
  await log(`✗ 오래된 글 삭제 실패: ${err.message}`, { level: 'error' })
}

// 인스타 접속은 정해진 시간에만
if (!now) {
  const hour = koreaHour()
  if (hour < ACTIVE_HOURS[0] || hour >= ACTIVE_HOURS[1]) {
    console.log(`지금은 ${hour}시라 인스타 확인은 쉽니다. (${ACTIVE_HOURS[0]}~${ACTIVE_HOURS[1]}시에만)`)
    process.exit(0)
  }
  await sleep(Math.random() * START_JITTER_MS)
}

const config = await loadConfig()
const active = config.accounts.filter((a) => !a.hidden) // 숨긴 매장은 수집하지 않음
const byUsername = new Map(active.map((a) => [a.username, a]))

// 이미 아는 글 = DB에 있는 글 + 지운 글 (지운 글이 피드에 보여도 "새 글"로 보지 않음)
const { data: recent, error } = await db.from('posts').select('code').order('posted_at', { ascending: false }).limit(500)
if (error) throw new Error(error.message)
const known = new Set([...recent.map((r) => r.code), ...(await loadDeletedCodes())])

const context = await openBrowser()
let failed = 0
const alerts = { loginRequired: false, errors: [], added: [] } // 카톡 알림용
try {
  // 0) 새 매장 신청 자동 검토 (한 번에 1건, 표에 자동 검토 칸이 없으면 건너뜀)
  const { data: toReview } = await db
    .from('shop_requests')
    .select('*')
    .eq('status', 'pending')
    .is('auto_checked_at', null)
    .order('created_at')
    .limit(1)
  // 검토는 검색용 계정으로 (부계정은 피드 읽기·팔로우만). 검색용 계정 로그인이 없으면 검토만 건너뜀
  let searchCtx = null
  if (toReview?.length) {
    try {
      searchCtx = await openBrowser({ search: true })
      const cookies = await searchCtx.cookies('https://www.instagram.com')
      if (!cookies.some((c) => c.name === 'sessionid' && c.value)) throw new LoginRequiredError()
    } catch (err) {
      await searchCtx?.close().catch(() => {})
      searchCtx = null
      alerts.searchLoginRequired = true
      await log(`⚠ 검색용 계정 로그인 필요 → 매장 신청 자동 검토 건너뜀 (npm run login:search)`, { level: 'warn' })
    }
  }
  for (const req of searchCtx ? toReview : []) {
    const stamp = new Date().toISOString()
    try {
      const naver = await openNaverBrowser()
      let r
      try {
        const opts = {
          registered: new Set(config.accounts.map((a) => a.username)),
          canAutoAdd: (await autoAddedToday()) < AUTO_ADD_PER_DAY,
          knownBranches: config.accounts.flatMap((a) => a.branches),
        }
        r = await retryNetwork(`매장 신청 검토 @${req.username}`, () => reviewRequest(searchCtx, naver.context, req, opts))
      } finally {
        await naver.browser.close()
      }
      const base = { auto_checked_at: stamp, auto_note: r.note.slice(0, 500) }
      const row =
        r.decision === 'approve'
          ? { ...base, status: 'approved', auto_approved: true, reviewed_at: stamp, display_name: r.displayName, region: r.region, account_type: r.accountType ?? '굿즈샵', naver_place_id: r.naverPlaceId }
          : r.decision === 'reject'
            ? { ...base, status: 'rejected', reviewed_at: stamp, result: `자동 거절: ${r.note}`.slice(0, 500) }
            : { ...base, naver_place_id: r.naverPlaceId, account_type: req.account_type ?? r.accountType, display_name: r.displayName ?? req.display_name, region: r.region ?? req.region }
      const u = await db.from('shop_requests').update(row).eq('id', req.id)
      if (u.error) throw new Error(u.error.message)
      const label = { approve: '자동 승인', reject: '자동 거절', manual: '관리자 확인 필요' }[r.decision]
      await log(`🔎 매장 신청 @${req.username} ${label}: ${r.note}`, { account: req.username })
    } catch (err) {
      // 검색용 계정 로그인이 풀린 것 (부계정 문제 아님) → 검토만 멈추고 수집은 계속
      if (err instanceof LoginRequiredError) {
        alerts.searchLoginRequired = true
        await log(`⚠ 검색용 계정 로그인 풀림 → 매장 신청 자동 검토 멈춤 (npm run login:search)`, { level: 'warn' })
        continue
      }
      // 인터넷 문제면 검토한 것으로 치지 않고 다음 실행 때 다시 검토
      if (!NETWORK_ERR.test(String(err?.message))) {
        await db.from('shop_requests').update({ auto_checked_at: stamp, auto_note: `자동 검토 실패: ${shortError(err)}`.slice(0, 500) }).eq('id', req.id)
      }
      await log(`✗ 매장 신청 자동 검토 실패 @${req.username}: ${shortError(err)}`, { level: 'error', account: req.username })
    }
    await pause()
  }
  await searchCtx?.close().catch(() => {})

  // 1) 승인된 매장 추가 (관리자 승인 + 자동 승인)
  const { data: approved } = await db.from('shop_requests').select('*').eq('status', 'approved').order('created_at')
  for (const req of approved ?? []) {
    try {
      if (config.accounts.some((a) => a.username === req.username)) throw new Error('이미 등록된 매장입니다.')
      const r = await retryNetwork(`매장 추가 @${req.username}`, () =>
        addShop(
          context,
          { username: req.username, displayName: req.display_name, region: req.region, accountType: req.account_type, naverPlaceId: req.naver_place_id },
          config.works,
        ),
      )
      const msg = `${r.account.displayName} 추가 완료: 글 ${r.total}개, 사진 ${r.imagesUploaded}장${r.followed === 'failed' ? ' (⚠ 팔로우 실패: 부계정으로 직접 팔로우 필요)' : ''}`
      // 매장 목록에 들어갔으니 신청은 바로 지움 (추가 기록은 수집 기록의 "🏪 … 추가 완료"로 남음)
      const del = await db.from('shop_requests').delete().eq('id', req.id)
      if (del.error) await db.from('shop_requests').update({ status: 'done', result: msg }).eq('id', req.id) // 못 지우면 완료 표시 (30일 뒤 정리)
      await log(`🏪 ${msg}`, { account: req.username })
      alerts.added.push(r.account.displayName)
    } catch (err) {
      if (err instanceof LoginRequiredError) throw err
      // 인터넷 문제면 승인 상태 그대로 두고 다음 실행 때 다시 추가
      if (!NETWORK_ERR.test(String(err?.message))) {
        await db.from('shop_requests').update({ status: 'failed', result: shortError(err) }).eq('id', req.id)
      }
      await log(`✗ 매장 추가 실패 @${req.username}: ${shortError(err)}`, { level: 'error', account: req.username })
      alerts.errors.push(`매장 추가 실패 @${req.username}: ${shortError(err)}`)
    }
    await pause()
  }

  // 2) 팔로잉 피드
  const feed = await retryNetwork('피드 확인', () => fetchFollowingFeed(context, known))
  // 본문 없는 글은 새 글로 치지 않음 (수집하지 않으므로 매장 페이지를 열 필요 없음)
  const fresh = feed.filter((p) => byUsername.has(p.owner) && !known.has(p.code) && !hasNoCaption(p))
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
      const posts = await retryNetwork(account.displayName, () => fetchAccount(context, username))
      const r = await savePosts(account, posts, config.works)
      await saveProfile(username, posts.profile).catch(() => {}) // 프로필 저장 실패는 수집을 멈추지 않음
      await markCrawled(username)
      const why = stale?.username === username ? ' (정기 확인)' : ''
      await log(`✓ ${account.displayName}${why}: 새 글 ${r.added}개, 사진 ${r.imagesUploaded}장`, { account: username })
    } catch (err) {
      if (err instanceof LoginRequiredError) throw err
      failed++
      await log(`✗ ${account.displayName}: ${shortError(err)}`, { level: 'error', account: username })
      alerts.errors.push(`${account.displayName}: ${shortError(err)}`)
    }
  }
} catch (err) {
  failed++
  await log(`✗ ${shortError(err)}`, { level: 'error' })
  if (err instanceof LoginRequiredError) alerts.loginRequired = true
  else alerts.errors.push(shortError(err))
} finally {
  await context.close()
}

// 지점 정보를 네이버 지도에서 갱신 (일주일 지난 지점만, 한 번에 3곳까지)
try {
  const n = await syncNaver({ limit: 3, log })
  if (n) await log(`📍 네이버 지점 정보 ${n}곳 갱신`)
} catch (err) {
  await log(`✗ 네이버 지점 정보 갱신 실패: ${err.message}`, { level: 'error' })
}

// 관리자에게 카톡 알림 (문제, 새 매장 신청, 검토할 글 등)
await notifyAdmin(alerts, log)
process.exitCode = failed ? 1 : 0
