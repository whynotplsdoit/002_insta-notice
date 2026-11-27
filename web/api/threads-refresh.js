// 쓰레드 토큰 자동 연장 — Vercel 크론이 매일 오전 9시(KST) 호출 (web/vercel.json)
// 마지막 연장 뒤 7일이 지났을 때만 연장 (60일짜리 토큰). 누가 주소를 열어도 7일 안 됐으면 아무 일도 안 함.
// 실패하면 슬랙 #whynot_굿즈레이더 로 알림 (watchdog_send, 22-threads-alert.sql) — 고칠 때까지 매일 다시 옴
import { createClient } from '@supabase/supabase-js'
import { refreshIfNeeded, tokenInfo } from './_threads.js'

const kstDate = (iso) => (iso ? new Date(iso).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' }) : '알 수 없음')

export async function GET() {
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } })
  try {
    const result = await refreshIfNeeded(db)
    const { expires_at, refreshed_at } = await tokenInfo(db)
    return Response.json({ result, expires_at, refreshed_at })
  } catch (e) {
    console.error('쓰레드 토큰 연장 실패:', e.message)
    const expires = await tokenInfo(db).then((t) => t.expires_at).catch(() => null)
    const days = expires ? Math.floor((new Date(expires).getTime() - Date.now()) / 86400000) : null
    const text = [
      `⚠️ 쓰레드 토큰 자동 연장 실패: ${e.message}`,
      `만료일 ${kstDate(expires)}${days != null ? ` (${days}일 남음)` : ''}. 만료되면 슬랙·PC 에서 쓰레드 글을 못 올립니다.`,
      '고치는 법: PC 에서 npm run threads:auth → 나온 주소 열어 허용 → 넘어간 주소로 npm run threads:auth -- "주소"',
    ].join('\n')
    const { error } = await db.rpc('watchdog_send', { msg: text })
    if (error) console.error('슬랙 알림도 실패:', error.message)
    return Response.json({ error: e.message, alerted: !error }, { status: 500 })
  }
}
