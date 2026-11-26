// 이미 저장된 사진(글 사진 + 프로필 사진)을 한 번에 작게 줄이기
// 사용법: npm run shrink:images            (실제로 줄임)
//         npm run shrink:images -- --dry   (바꾸지 않고 얼마나 줄어드는지만 봄)
// 이미 줄인 사진(webp, 목표 폭 이하)은 건너뛰므로 여러 번 돌려도 괜찮음.
import sharp from 'sharp'
import { db } from './db.mjs'
import { CACHE_SECONDS, POST_WIDTH, PROFILE_WIDTH, shrinkImage } from './shrink.mjs'

const BUCKET = 'post-images'
const DRY = process.argv.includes('--dry')
const kb = (n) => `${(n / 1024).toFixed(0)}KB`
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)}MB`

async function selectAll(table, cols, pathCol) {
  const rows = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(cols).not(pathCol, 'is', null).range(from, from + 999)
    if (error) throw new Error(`${table} 읽기: ${error.message}`)
    rows.push(...data)
    if (data.length < 1000) return rows
  }
}

const stats = { done: 0, skipped: 0, failed: 0, before: 0, after: 0 }
const moved = [] // { table, keyCol, key, pathCol, oldPath, newPath } — 확장자가 바뀐 것 (옛 파일은 맨 끝에 지움)

async function shrinkOne({ table, keyCol, key, pathCol, oldPath, width }) {
  const { data: blob, error } = await db.storage.from(BUCKET).download(oldPath)
  if (error) {
    stats.failed++
    console.log(`  ✗ 받기 실패 ${oldPath}: ${error.message}`)
    return
  }
  const buf = Buffer.from(await blob.arrayBuffer())
  const meta = await sharp(buf, { failOn: 'none' }).metadata().catch(() => null)
  if (meta?.format === 'webp' && (meta.width ?? 0) <= width) {
    stats.skipped++
    return
  }
  const small = await shrinkImage(buf, width)
  stats.before += buf.length
  stats.after += small.length
  stats.done++
  const newPath = oldPath.replace(/\.[^./]+$/, '') + '.webp'
  if (DRY) return
  const up = await db.storage
    .from(BUCKET)
    .upload(newPath, small, { contentType: 'image/webp', upsert: true, cacheControl: CACHE_SECONDS })
  if (up.error) {
    stats.failed++
    console.log(`  ✗ 올리기 실패 ${newPath}: ${up.error.message}`)
    return
  }
  const row = { [pathCol]: newPath }
  if (table === 'accounts') row.profile_updated_at = new Date().toISOString() // 브라우저가 새 사진을 받도록 (?v=)
  if (newPath !== oldPath || table === 'accounts') {
    const { error: ue } = await db.from(table).update(row).eq(keyCol, key)
    if (ue) console.log(`  ✗ DB 갱신 실패 ${key}: ${ue.message}`)
  }
  if (newPath !== oldPath) moved.push({ table, keyCol, key, pathCol, oldPath, newPath })
}

async function run(jobs, label) {
  console.log(`${label} ${jobs.length}장 확인 중...`)
  let i = 0
  const worker = async () => {
    while (i < jobs.length) {
      const job = jobs[i++]
      try {
        await shrinkOne(job)
      } catch (e) {
        stats.failed++
        console.log(`  ✗ ${job.oldPath}: ${e.message}`)
      }
      if (i % 50 === 0) console.log(`  ${i}/${jobs.length}`)
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()])
}

const posts = await selectAll('posts', 'code, image_path', 'image_path')
await run(
  posts.map((p) => ({ table: 'posts', keyCol: 'code', key: p.code, pathCol: 'image_path', oldPath: p.image_path, width: POST_WIDTH })),
  '글 사진',
)
const accounts = await selectAll('accounts', 'username, profile_image_path', 'profile_image_path')
await run(
  accounts.map((a) => ({
    table: 'accounts',
    keyCol: 'username',
    key: a.username,
    pathCol: 'profile_image_path',
    oldPath: a.profile_image_path,
    width: PROFILE_WIDTH,
  })),
  '프로필 사진',
)

if (!DRY && moved.length) {
  // 도는 동안 크롤러가 옛 경로로 다시 써 넣었을 수 있어서 한 번 더 맞춘 뒤 옛 파일 삭제
  for (const m of moved) {
    await db.from(m.table).update({ [m.pathCol]: m.newPath }).eq(m.keyCol, m.key).eq(m.pathCol, m.oldPath)
  }
  const old = moved.map((m) => m.oldPath)
  for (let k = 0; k < old.length; k += 100) {
    const { error } = await db.storage.from(BUCKET).remove(old.slice(k, k + 100))
    if (error) console.log(`  ✗ 옛 파일 삭제 실패: ${error.message}`)
  }
}

const saved = stats.before ? Math.round((1 - stats.after / stats.before) * 100) : 0
console.log(
  `${DRY ? '[미리보기] ' : ''}줄임 ${stats.done}장 (${mb(stats.before)} → ${mb(stats.after)}, ${saved}% 감소, ` +
    `평균 ${kb(stats.before / (stats.done || 1))} → ${kb(stats.after / (stats.done || 1))}), ` +
    `이미 작음 ${stats.skipped}장, 실패 ${stats.failed}장`,
)
