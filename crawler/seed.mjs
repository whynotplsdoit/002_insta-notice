// 처음 한 번: config/*.json 의 매장·작품 사전과 이미 수집해 둔 data/*.json 을 DB에 넣습니다. (인스타에 접속하지 않음)
// 이후 매장 목록은 DB가 원본입니다 (관리자 화면에서 수정). 다시 실행하면 json 내용으로 덮어쓰니 주의하세요.
// 사용법: npm run seed
import fs from 'node:fs/promises'
import { pushConfigFiles, savePosts } from './store.mjs'

const config = await pushConfigFiles()
console.log(`매장 ${config.accounts.length}곳, 작품 ${config.works.length}개 저장`)

for (const account of config.accounts) {
  let data
  try {
    data = JSON.parse(await fs.readFile(`data/${account.username}.json`, 'utf8'))
  } catch {
    console.log(`- ${account.displayName}: data 파일 없음, 건너뜀`)
    continue
  }
  const r = await savePosts(account, data.posts, config.works)
  console.log(`- ${account.displayName}: 글 ${r.total}개 (새 글 ${r.added}), 사진 ${r.imagesUploaded}장 업로드`)
}
