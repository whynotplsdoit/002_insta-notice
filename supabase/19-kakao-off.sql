-- 카톡 알림 모두 끄기 (알림은 슬랙만)
-- 사용법: Supabase 대시보드 → SQL Editor → 이 파일 내용 전체 붙여넣기 → Run (여러 번 실행해도 안전)
--
-- 아침 7시 알림(daily_report)과 크롤러 멈춤 감시(watchdog_check)는 둘 다 watchdog_kakao 로 카톡을 보냄.
-- 이 함수를 "아무것도 안 함"으로 바꿔서 카톡만 끄고, 슬랙 알림은 그대로 둠.
-- 다시 켜려면 09-watchdog.sql 의 watchdog_kakao 부분을 다시 실행.

create or replace function public.watchdog_kakao(msg text, link text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  return; -- 카톡 알림 꺼 둠 (2026-11-26)
end;
$$;

revoke all on function public.watchdog_kakao(text, text) from public, anon, authenticated;
