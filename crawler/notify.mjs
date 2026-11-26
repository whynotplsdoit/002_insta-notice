// 관리자 알림 (카톡·슬랙): 같은 알림이 15분마다 반복되지 않도록 마지막으로 보낸 상태를 기억
// 상태 파일: %LOCALAPPDATA%\insta-notice\notify-state.json
import fs from 'node:fs/promises'
import path from 'node:path'
import { PROFILE_DIR } from './profile.mjs'
import { db } from './db.mjs'
import { kakaoConfigured, kakaoDaysLeft } from './kakao.mjs'
import { alertConfigured, sendAlert, SITE_URL } from './alert.mjs'
import { isNetworkError } from './retry.mjs'

const STATE_FILE = path.join(path.dirname(PROFILE_DIR), 'notify-state.json')
const ADMIN_URL = `${SITE_URL}/admin`

async function loadState() {
  try {
    return JSON.parse(await fs.readFile(STATE_FILE, 'utf8'))
  } catch {
    return {}
  }
}
const saveState = (s) => fs.writeFile(STATE_FILE, JSON.stringify(s, null, 2), 'utf8')

// 문제 알림: 같은 종류는 cooldownHours 안에 한 번만
async function once(state, key, cooldownHours, text, url) {
  const last = state.sent?.[key] ?? 0
  if (Date.now() - last < cooldownHours * 3600_000) return
  await sendAlert(text, url)
  state.sent = { ...state.sent, [key]: Date.now() }
}

// 수집 문제 알림 고르기 (state 를 고쳐 "보낸 시각"을 기록하고, 보낼 문구 목록을 돌려줌)
// - 인터넷 문제(재시도 3번까지 실패): 6시간에 한 번만 (와이파이·VPN이 자주 바뀌어도 알림이 쏟아지지 않게)
// - 그 밖의 문제: 같은 오류가 반복돼도 매번 바로 알림 (사용자 결정)
const ERROR_COOLDOWN = 6 * 3600_000
export function pickErrorAlerts(errors, state, now = Date.now()) {
  const out = []
  const isNet = (m) => isNetworkError(m) || m.includes('인터넷 연결이')
  const netErrors = errors.filter(isNet)
  const otherErrors = [...new Set(errors.filter((m) => !isNet(m)))]
  if (netErrors.length && now - (state.sent?.['crawl-error-net'] ?? 0) >= ERROR_COOLDOWN) {
    out.push(`⚠️ 인터넷 연결 문제로 수집 실패 (3번 시도)\n${netErrors.slice(0, 3).join('\n')}`)
    state.sent = { ...state.sent, 'crawl-error-net': now }
  }
  if (otherErrors.length) out.push(`⚠️ 수집 중 문제 ${otherErrors.length}건\n${otherErrors.slice(0, 5).join('\n')}`)
  delete state.errSent // 예전 "같은 오류 6시간" 기록은 더 이상 쓰지 않음
  return out
}

// watch.mjs 가 매번 끝날 때 호출
// problems: { loginRequired: bool, errors: [문구] }  (매장 추가 완료는 알리지 않음)
export async function notifyAdmin({ loginRequired = false, searchLoginRequired = false, errors = [] } = {}, log = console.log) {
  if (!alertConfigured()) return
  const state = await loadState()
  try {
    if (loginRequired) {
      await once(state, 'ig-login', 1,'🚨 인스타 로그인이 풀려서 수집이 멈췄습니다.\nPC에서 npm run login 으로 부계정 로그인을 다시 해주세요.', ADMIN_URL + '?tab=status')
    }
    // 검색용 계정: 수집은 계속되고 매장 신청 자동 검토만 멈춤 → 6시간에 한 번
    if (searchLoginRequired) {
      await once(state, 'ig-search-login', 6, '🔎 검색용 인스타 계정 로그인이 필요합니다. 매장 신청 자동 검토가 멈춰 있어요.\nPC에서 npm run login:search 로 검색용 계정에 로그인해 주세요.', ADMIN_URL + '?tab=requests')
    }
    for (const text of pickErrorAlerts(errors, state)) await sendAlert(text, ADMIN_URL + '?tab=status')

    // 매장 신청·의견은 바로 알리지 않고 Supabase 가 매일 아침 7시에 건수로 알림 (supabase/12-daily-report.sql)

    // 검토할 기타 글: 지난번보다 늘었을 때만
    const { count } = await db.from('posts').select('code', { count: 'exact', head: true }).eq('needs_review', true)
    if ((count ?? 0) > (state.reviewCount ?? 0)) {
      await sendAlert(`📝 검토할 '기타' 글이 ${count}개 있습니다.`, ADMIN_URL + '?tab=review')
    }
    state.reviewCount = count ?? 0

    // 카카오 로그인 만료 예고 (하루 한 번, 카톡을 쓸 때만)
    if (kakaoConfigured()) {
      const days = await kakaoDaysLeft()
      if (days !== null && days <= 10) {
        await once(state, 'kakao-expire', 24, `🔑 카톡 알림 연결이 ${days}일 뒤 끊깁니다.\nPC에서 npm run kakao:login 을 한 번 실행해 주세요.`)
      }
    }
  } catch (err) {
    await log(`✗ 관리자 알림 실패: ${err.message}`, { level: 'error' })
  } finally {
    await saveState(state)
  }
}
