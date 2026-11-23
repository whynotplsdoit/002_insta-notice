// 관리자 계정 등록 (처음 한 번)
// 사용법: npm run setup:admin -- 이메일주소
//
// 1) Supabase 로그인 사용자로 만들고 (이메일 확인 완료 상태)
// 2) 관리자 목록(admins)에 넣습니다.
// 관리자 화면 로그인은 미리 등록된 이메일만 가능합니다. (아무나 가입 불가)
import { db } from './db.mjs'

const email = (process.argv[2] ?? '').trim().toLowerCase()
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error('사용법: npm run setup:admin -- 이메일주소')
  process.exit(1)
}

const { error: createError } = await db.auth.admin.createUser({ email, email_confirm: true })
if (createError && !/already|registered|exists/i.test(createError.message)) {
  throw new Error(`로그인 사용자 만들기 실패: ${createError.message}`)
}
const { error } = await db.from('admins').upsert({ email })
if (error) throw new Error(`관리자 등록 실패: ${error.message}`)
console.log(`✓ 관리자 등록 완료: ${email}`)
