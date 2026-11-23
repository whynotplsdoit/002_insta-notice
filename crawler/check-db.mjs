// Supabase 연결과 표가 잘 만들어졌는지 확인합니다.
// 사용법: npm run check:db
import { db } from './db.mjs'

let ok = true
for (const table of ['accounts', 'branches', 'posts', 'works']) {
  const { data, error, status } = await db.from(table).select('*').limit(1)
  if (error || !Array.isArray(data)) {
    ok = false
    console.log(`✗ ${table}: 표 없음 또는 접근 불가 (상태 ${status}${error?.message ? ', ' + error.message : ''})`)
  } else {
    console.log(`✓ ${table}: 있음`)
  }
}

const { data: buckets, error: bErr } = await db.storage.listBuckets()
if (bErr) {
  ok = false
  console.log(`✗ 사진 저장소: ${bErr.message}`)
} else {
  const has = buckets.some((b) => b.id === 'post-images')
  if (!has) ok = false
  console.log(`${has ? '✓' : '✗'} 사진 저장소 post-images ${has ? '있음' : '없음'}`)
}

console.log(ok ? '\n연결 성공' : '\n문제가 있습니다. supabase/schema.sql 을 SQL Editor 에서 실행했는지 확인하세요.')
