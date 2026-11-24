// 관리자 알림 (카톡·슬랙): 같은 알림이 15분마다 반복되지 않도록 마지막으로 보낸 상태를 기억
// 상태 파일: %LOCALAPPDATA%\insta-notice\notify-state.json
import fs from 'node:fs/promises'
import path from 'node:path'
import { PROFILE_DIR } from './profile.mjs'
import { db } from './db.mjs'
import { kakaoConfigured, kakaoDaysLeft } from './kakao.mjs'
import { alertConfigured, sendAlert, SITE_URL } from './alert.mjs'

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

// watch.mjs 가 매번 끝날 때 호출
// problems: { loginRequired: bool, errors: [문구] }  (매장 추가 완료는 알리지 않음)
export async function notifyAdmin({ loginRequired = false, errors = [] } = {}, log = console.log) {
  if (!alertConfigured()) return
  const state = await loadState()
  try {
    if (loginRequired) {
      await once(state, 'ig-login', 6, '🚨 인스타 로그인이 풀려서 수집이 멈췄습니다.\nPC에서 npm run login 으로 부계정 로그인을 다시 해주세요.', ADMIN_URL + '?tab=status')
    }
    if (errors.length) {
      await once(state, 'crawl-error', 6, `⚠️ 수집 중 문제 ${errors.length}건\n${errors.slice(0, 3).join('\n')}`, ADMIN_URL + '?tab=status')
    }

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
