// 임시: 지점별 네이버 플레이스 후보 찾기 (확인 후 삭제)
import fs from 'node:fs/promises'
import { db } from './db.mjs'
import { openNaverBrowser, findPlaces, fetchPlace } from './naver.mjs'

const out = process.argv[2]
const [{ data: accounts }, { data: branches }] = await Promise.all([
  db.from('accounts').select('username, display_name'),
  db.from('branches').select('id, account_username, name, region, address').order('id'),
])
const nameOf = new Map(accounts.map((a) => [a.username, a.display_name]))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const { browser, context } = await openNaverBrowser()
const results = []
for (const b of branches) {
  const shop = nameOf.get(b.account_username)
  const query = `${shop} ${b.name.includes('호점') || b.name === '매장' ? (b.region ?? '') + ' ' + b.name : b.name}`.replace(/\s+/g, ' ').trim()
  const ids = await findPlaces(context, query)
  const cands = []
  for (const id of ids.slice(0, 3)) {
    try {
      const p = await fetchPlace(context, id)
      const ig = p.homepages.some((u) => u.toLowerCase().includes(b.account_username.toLowerCase()))
      cands.push({ ...p, igMatch: ig })
    } catch (e) {
      cands.push({ id, error: e.message })
    }
    await sleep(800)
  }
  const pick = cands.find((c) => c.igMatch) ?? null
  results.push({ branch: b, shop, query, cands, pick })
  console.log(`\n■ ${shop} ${b.name}  (검색: ${query})`)
  for (const c of cands) console.log(`   ${c.igMatch ? '✅' : '  '} ${c.id} | ${c.name ?? c.error} | ${c.roadAddress ?? ''} | ${c.phone ?? ''} | IG ${c.homepages?.find((u) => u.includes('instagram')) ?? '-'}`)
  await sleep(1500)
}
await fs.writeFile(`${out}/naver-candidates.json`, JSON.stringify(results, null, 1))
await browser.close()
