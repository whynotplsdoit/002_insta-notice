// Supabase 연결 (크롤러 전용: 비밀 키 사용)
// .env 는 package.json 스크립트에서 node --env-file=.env 로 읽어옵니다.
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const secret = process.env.SUPABASE_SECRET_KEY
if (!url || !secret) {
  throw new Error('.env 에 SUPABASE_URL 과 SUPABASE_SECRET_KEY 를 넣어주세요.')
}

export const db = createClient(url, secret, { auth: { persistSession: false } })
