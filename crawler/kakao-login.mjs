// 카카오톡 알림 처음 설정: 카카오 로그인·허락 → 토큰 저장 → 시험 메시지
// 사용법: npm run kakao:login
// 이 PC에서 잠깐 주소(localhost:5179)를 열어 카카오가 돌려주는 코드를 받습니다. 비밀번호는 다루지 않습니다.
import http from 'node:http'
import { exec } from 'node:child_process'
import { authorizeUrl, exchangeCode, sendKakao, kakaoDaysLeft } from './kakao.mjs'

const url = authorizeUrl()
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost:5179')
  if (u.pathname !== '/kakao') return res.writeHead(404).end()
  const code = u.searchParams.get('code')
  const error = u.searchParams.get('error_description') ?? u.searchParams.get('error')
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  if (!code) {
    res.end(`<h2>허락하지 않았거나 오류가 났습니다.</h2><p>${error ?? ''}</p>`)
    console.log('KAKAO_FAIL:', error)
    server.close()
    return
  }
  try {
    await exchangeCode(code)
    await sendKakao('✅ 굿즈레이더 알림이 연결됐습니다.\n앞으로 수집에 문제가 생기거나 매장 신청·검토할 글이 생기면 여기로 알려드릴게요.')
    res.end('<h2>✅ 연결 완료! 카카오톡 "나와의 채팅"을 확인하세요.</h2><p>이 창은 닫아도 됩니다.</p>')
    console.log(`KAKAO_OK: 시험 메시지를 보냈습니다. (로그인 유효 약 ${await kakaoDaysLeft()}일, 쓰는 동안 자동 연장)`)
  } catch (err) {
    res.end(`<h2>연결 실패</h2><p>${err.message}</p>`)
    console.log('KAKAO_FAIL:', err.message)
  }
  server.close()
})

server.listen(5179, () => {
  console.log('브라우저에서 카카오 로그인 후 "동의하고 계속하기"를 눌러 주세요. (5분 안에)')
  exec(`start "" "${url}"`) // 기본 브라우저로 열기 (Windows)
  setTimeout(() => {
    console.log('KAKAO_TIMEOUT: 5분이 지나 종료합니다.')
    server.close()
    process.exit(1)
  }, 5 * 60_000).unref()
})
