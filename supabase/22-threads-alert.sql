-- 22. 쓰레드 토큰 자동 연장이 실패하면 슬랙 알림
-- Vercel(/api/threads-refresh, 매일 09시)이 기존 감시 알림 함수 watchdog_send 로 #whynot_굿즈레이더 에 보냄
-- Supabase → SQL Editor 에서 한 번 실행 (웹 화면 공개 키로는 여전히 못 부름)
grant execute on function public.watchdog_send(text) to service_role;
