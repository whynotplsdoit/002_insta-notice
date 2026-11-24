// 슬랙 채널로 알림 보내기 (Incoming Webhook)
// .env 의 SLACK_WEBHOOK_URL 에 슬랙에서 만든 웹후크 주소를 넣으면 동작합니다.
export const slackConfigured = () => Boolean(process.env.SLACK_WEBHOOK_URL)

export async function sendSlack(text, url) {
  const blocks = [{ type: 'section', text: { type: 'mrkdwn', text } }]
  if (url) {
    blocks.push({
      type: 'actions',
      elements: [{ type: 'button', text: { type: 'plain_text', text: '굿즈레이더 열기' }, url }],
    })
  }
  const res = await fetch(process.env.SLACK_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, blocks }), // text 는 알림 미리보기용
  })
  if (!res.ok) throw new Error(`슬랙 보내기 실패: ${res.status} ${await res.text()}`)
}
