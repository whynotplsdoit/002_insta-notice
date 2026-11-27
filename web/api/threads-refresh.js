// 쓰레드 토큰 자동 연장 — Vercel 크론이 매일 오전 9시(KST) 호출 (web/vercel.json)
// 마지막 연장 뒤 7일이 지났을 때만 연장 (60일짜리 토큰). 누가 주소를 열어도 7일 안 됐으면 아무 일도 안 함.
import { createClient } from '@supabase/supabase-js'
import { refreshIfNeeded, tokenInfo } from './_threads.js'

export async function GET() {
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } })
  try {
    const result = await refreshIfNeeded(db)
    const { expires_at, refreshed_at } = await tokenInfo(db)
    return Response.json({ result, expires_at, refreshed_at })
  } catch (e) {
    console.error('쓰레드 토큰 연장 실패:', e.message)
    return Response.json({ error: e.message }, { status: 500 })
  }
}
