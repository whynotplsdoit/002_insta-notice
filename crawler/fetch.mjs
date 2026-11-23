// 매장 하나를 수집해서 data/<아이디>.json 으로 저장합니다. (DB에는 넣지 않음, 시험용)
// 사용법: npm run fetch -- shirostore_hongdae
import fs from 'node:fs/promises'
import { openBrowser, fetchAccount } from './instagram.mjs'

const username = process.argv[2]
if (!username || !/^[A-Za-z0-9._]+$/.test(username)) {
  console.error('사용법: npm run fetch -- <인스타그램 아이디>')
  process.exit(1)
}

const context = await openBrowser()
try {
  const posts = await fetchAccount(context, username)
  await fs.mkdir('data', { recursive: true })
  const file = `data/${username}.json`
  await fs.writeFile(file, JSON.stringify({ username, fetchedAt: new Date().toISOString(), posts }, null, 2), 'utf8')
  console.log(`SAVED ${file} (게시물 ${posts.length}개)`)
} catch (err) {
  console.error('FETCH_ERROR:', err.message)
  process.exitCode = 1
} finally {
  await context.close()
}
