// 임시: 못 찾은 지점 다시 찾기 (확인 후 삭제)
import { openNaverBrowser, findPlaces, fetchPlace } from './naver.mjs'
const queries = ['애니메이트카페 홍대', '애니메이트 홍대점', '애니메이트카페 부산', '애니메이트 부산 서면', '애니메이트카페 잠실', '애니메이트 잠실 롯데월드몰', '더꼬꼬굿즈 1호점', '더꼬꼬굿즈 홍대']
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const { browser, context } = await openNaverBrowser()
const seen = new Set()
for (const q of queries) {
  const ids = (await findPlaces(context, q)).filter((id) => !seen.has(id))
  console.log(`\n■ ${q}`)
  for (const id of ids.slice(0, 3)) {
    seen.add(id)
    try {
      const p = await fetchPlace(context, id)
      console.log(`   ${id} | ${p.name} | ${p.roadAddress} | ${p.phone ?? ''} | ${p.category} | IG ${p.homepages.find((u) => u.includes('instagram')) ?? '-'}`)
    } catch (e) {
      console.log(`   ${id} | ${e.message}`)
    }
    await sleep(800)
  }
  await sleep(1200)
}
await browser.close()
