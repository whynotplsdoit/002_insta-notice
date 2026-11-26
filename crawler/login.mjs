// 자동화용 브라우저 창을 열고, 사용자가 직접 인스타그램에 로그인할 때까지 기다립니다.
// 비밀번호는 이 스크립트가 다루지 않습니다. 로그인 상태(쿠키)만 PROFILE_DIR에 남습니다.
// --search 를 붙이면 검색용 계정 프로필 (npm run login:search)
import { chromium } from 'playwright'
import { PROFILE_DIR, SEARCH_PROFILE_DIR, SEARCH2_PROFILE_DIR } from './profile.mjs'

const TIMEOUT_MS = 10 * 60 * 1000 // 최대 10분 대기
const SEARCH2 = process.argv.includes('--search2')
const SEARCH = SEARCH2 || process.argv.includes('--search')

// --edge: 크롤러 전용 프로필을 엣지 화면으로 열기 (엣지 원래 프로필과는 섞이지 않음)
// 검색용 계정 2 는 엣지로 로그인 → 크롤러도 그 프로필을 엣지로 엶 (instagram.mjs)
const useEdge = process.argv.includes('--edge') || SEARCH2

const context = await chromium.launchPersistentContext(SEARCH2 ? SEARCH2_PROFILE_DIR : SEARCH ? SEARCH_PROFILE_DIR : PROFILE_DIR, {
  ...(useEdge ? { channel: 'msedge' } : {}),
  headless: false,
  viewport: { width: 1100, height: 900 },
  locale: 'ko-KR',
})
const page = context.pages()[0] ?? (await context.newPage())
await page.goto('https://www.instagram.com/accounts/login/')

console.log(`브라우저 창에서 ${SEARCH2 ? '검색용 계정 2' : SEARCH ? '검색용 계정' : '부계정'}으로 로그인해 주세요. (최대 10분 대기)`)

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
