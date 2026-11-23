// 자동화용 브라우저 창을 열고, 사용자가 직접 인스타그램에 로그인할 때까지 기다립니다.
// 비밀번호는 이 스크립트가 다루지 않습니다. 로그인 상태(쿠키)만 PROFILE_DIR에 남습니다.
import { chromium } from 'playwright'
import { PROFILE_DIR } from './profile.mjs'

const TIMEOUT_MS = 10 * 60 * 1000 // 최대 10분 대기

const context = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: false,
  viewport: { width: 1100, height: 900 },
  locale: 'ko-KR',
})
const page = context.pages()[0] ?? (await context.newPage())
await page.goto('https://www.instagram.com/accounts/login/')

console.log('브라우저 창에서 부계정으로 로그인해 주세요. (최대 10분 대기)')

const start = Date.now()
let loggedIn = false
while (Date.now() - start < TIMEOUT_MS) {
  const cookies = await context.cookies('https://www.instagram.com')
  if (cookies.some((c) => c.name === 'sessionid' && c.value)) {
    loggedIn = true
    break
  }
  await new Promise((r) => setTimeout(r, 2000))
}

if (loggedIn) {
  // 로그인 직후 뜨는 "정보 저장" 같은 화면이 끝나도록 잠깐 기다립니다.
  await new Promise((r) => setTimeout(r, 5000))
  console.log('LOGIN_OK: 로그인 확인. 창을 닫습니다.')
} else {
  console.log('LOGIN_TIMEOUT: 10분 안에 로그인하지 않아 종료합니다.')
}
await context.close()
