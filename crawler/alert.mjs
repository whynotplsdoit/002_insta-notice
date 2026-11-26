// 관리자 알림 보내기: 설정된 곳 모두로 (카카오톡 나에게 보내기, 슬랙 채널)
// 카톡은 지금 꺼 둠 (kakao.mjs KAKAO_ALERTS_ON) → 슬랙만 보냄
// - 카톡: .env KAKAO_REST_API_KEY + npm run kakao:login 으로 연결했을 때
// - 슬랙: .env SLACK_WEBHOOK_URL 이 있을 때
// 모든 알림 맨 앞에 [굿즈레이더] 를 붙입니다.
import { kakaoConfigured, sendKakao } from './kakao.mjs'
import { slackConfigured, sendSlack } from './slack.mjs'

const PREFIX = '[굿즈레이더] '
export const SITE_URL = 'https://goods-radar-xi.vercel.app'

export const alertConfigured = () => kakaoConfigured() || slackConfigured()

// 한 곳이 실패해도 다른 곳은 보냄. 모두 실패하면 오류
export async function sendAlert(text, url = SITE_URL) {
  const body = text.startsWith(PREFIX) ? text : PREFIX + text
  const jobs = []
  if (kakaoConfigured()) jobs.push(['카톡', sendKakao(body, url)])
  if (slackConfigured()) jobs.push(['슬랙', sendSlack(body, url)])
  const results = await Promise.allSettled(jobs.map(([, p]) => p))
  const errors = results.map((r, i) => (r.status === 'rejected' ? `${jobs[i][0]}: ${r.reason.message}` : null)).filter(Boolean)
  if (errors.length) throw new Error(errors.join(' / '))
}
