// 지점 정보를 네이버 지도에서 갱신 (일주일에 한 번)
// - 네이버 플레이스 번호(naver_place_id)가 연결된 지점만
// - 관리자가 직접 입력한 지점(info_manual)은 주소·전화·영업시간을 덮어쓰지 않음
//
// 사용법
//   npm run naver              갱신할 때가 된 지점만 (watch.mjs 가 매번 몇 곳씩 자동으로 함)
//   npm run naver -- --all     연결된 모든 지점 지금 갱신
import { pathToFileURL } from 'node:url'
import { db } from './db.mjs'
import { openNaverBrowser, fetchPlace } from './naver.mjs'

export const NAVER_REFRESH_DAYS = 7

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 반환: 갱신한 지점 수
export async function syncNaver({ all = false, limit = 3, log = console.log } = {}) {
  const { data, error } = await db.from('branches').select('*').not('naver_place_id', 'is', null).order('naver_updated_at', { nullsFirst: true })
  if (error) throw new Error(`지점 읽기: ${error.message}`)
  const due = all
    ? data
    : data
        .filter((b) => !b.naver_updated_at || Date.now() - new Date(b.naver_updated_at).getTime() > NAVER_REFRESH_DAYS * 86400000)
        .slice(0, limit)
  if (due.length === 0) return 0

  const { browser, context } = await openNaverBrowser()
  let done = 0
  try {
    for (const b of due) {
      try {
        const p = await fetchPlace(context, b.naver_place_id)
        const row = { naver_name: p.name, naver_category: p.category, naver_updated_at: new Date().toISOString() }
        if (!b.info_manual) {
          Object.assign(row, {
            address: p.roadAddress ?? p.address ?? b.address,
            phone: p.phone,
            directions: p.directions,
            hours: p.hours.length ? p.hours : null,
            closed_regular: p.closedRegular,
            closed_coming: p.closedComing,
            hours_note: p.hoursNote,
          })
        }
        const u = await db.from('branches').update(row).eq('id', b.id)
        if (u.error) throw new Error(u.error.message)
        done++
      } catch (err) {
        await log(`✗ 네이버 지점 정보 갱신 실패 (${b.account_username} ${b.name}): ${err.message}`, { level: 'error', account: b.account_username })
      }
      await sleep(1500 + Math.random() * 2000)
    }
  } finally {
    await browser.close()
  }
  return done
}

// 직접 실행했을 때
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const n = await syncNaver({ all: process.argv.includes('--all'), limit: 100 })
  console.log(`네이버 지점 정보 ${n}곳 갱신`)
}
