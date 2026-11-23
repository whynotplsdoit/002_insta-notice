// 이미 수집한 data/*.json으로 분류기를 시험합니다.
// 사용법: npm run test:classify
import fs from 'node:fs/promises'
import { classifyPosts } from './classify.mjs'

const accounts = JSON.parse(await fs.readFile('config/accounts.json', 'utf8'))
const works = JSON.parse(await fs.readFile('config/works.json', 'utf8'))

const totals = {}
const candidates = new Map()
const rows = []

for (const account of accounts) {
  let data
  try {
    data = JSON.parse(await fs.readFile(`data/${account.username}.json`, 'utf8'))
  } catch {
    console.log(`(건너뜀) data/${account.username}.json 없음`)
    continue
  }
  for (const p of classifyPosts(account, data.posts, works)) {
    totals[p.category] = (totals[p.category] ?? 0) + 1
    for (const t of p.newTagCandidates) candidates.set(t, (candidates.get(t) ?? 0) + 1)
    const fmt = (iso) =>
      iso ? new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: 'numeric' }) : ''
    rows.push({
      매장: account.displayName,
      분류: p.category,
      종류: p.goodsType.join(','),
      작품: p.works.join(', '),
      지점: p.branches.join(','),
      일시: [fmt(p.startsAt), fmt(p.endsAt)].filter(Boolean).join(' ~ '),
      본문: (p.caption || '(본문 없음)').replace(/\s+/g, ' ').slice(0, 45),
    })
  }
}

const out = rows
  .map((r) => `${r.매장} | ${r.분류} | ${r.종류} | ${r.작품} | ${r.지점} | ${r.일시} | ${r.본문}`)
  .join('\n')
await fs.mkdir('data', { recursive: true })
await fs.writeFile('data/classify-result.txt', out, 'utf8')

console.log(out)
console.log('\n분류별 개수:', totals)
console.log('새 작품 후보 해시태그:', [...candidates].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t}(${n})`).join(' '))
