// 이미 저장된 글 사진에 목록용 작은 사진(코드.t.webp)이 없으면 만들어 올림
// 사용법: npm run make:thumbs   (이미 있는 건 건너뛰므로 여러 번 돌려도 괜찮음)
import { db } from './db.mjs'
import { CACHE_SECONDS, THUMB_WIDTH, shrinkImage, thumbPath } from './shrink.mjs'

const BUCKET = 'post-images'

const posts = []
for (let from = 0; ; from += 1000) {
  const { data, error } = await db.from('posts').select('image_path').like('image_path', '%.webp').range(from, from + 999)
  if (error) throw new Error(`글 읽기: ${error.message}`)
  posts.push(...data)
  if (data.length < 1000) break
}

// 폴더(매장)별로 이미 있는 파일 이름 모으기
const have = new Set()
for (const folder of new Set(posts.map((p) => p.image_path.split('/')[0]))) {
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.storage.from(BUCKET).list(folder, { limit: 1000, offset })
    if (error) throw new Error(`${folder} 파일 목록: ${error.message}`)
    for (const f of data) have.add(`${folder}/${f.name}`)
    if (data.length < 1000) break
  }
}

const todo = posts.map((p) => p.image_path).filter((p) => !have.has(thumbPath(p)))
console.log(`글 사진 ${posts.length}장 중 작은 사진 만들 것 ${todo.length}장`)
let i = 0
let made = 0
let failed = 0
let bytes = 0
const worker = async () => {
  while (i < todo.length) {
    const path = todo[i++]
    try {
      const { data: blob, error } = await db.storage.from(BUCKET).download(path)
      if (error) throw error
      const small = await shrinkImage(Buffer.from(await blob.arrayBuffer()), THUMB_WIDTH)
      const up = await db.storage
        .from(BUCKET)
        .upload(thumbPath(path), small, { contentType: 'image/webp', upsert: true, cacheControl: CACHE_SECONDS })
      if (up.error) throw up.error
      made++
      bytes += small.length
    } catch (e) {
      failed++
      console.log(`  ✗ ${path}: ${e.message}`)
    }
    if (i % 100 === 0) console.log(`  ${i}/${todo.length}`)
  }
}
await Promise.all([worker(), worker(), worker(), worker()])
console.log(`만듦 ${made}장 (평균 ${(bytes / (made || 1) / 1024).toFixed(0)}KB), 실패 ${failed}장`)
process.exit(0)
