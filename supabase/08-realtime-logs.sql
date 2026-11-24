-- 관리자 화면 "수집 상태"를 크롤러가 기록을 남길 때만 새로고침하도록 실시간 알림 켜기
-- 사용법: Supabase 대시보드 → SQL Editor → 이 파일 내용 전체 붙여넣기 → Run (여러 번 실행해도 안전)
-- 수집 기록(crawl_logs)은 관리자만 읽을 수 있어서, 실시간 알림도 관리자에게만 갑니다.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'crawl_logs'
  ) then
    alter publication supabase_realtime add table public.crawl_logs;
  end if;
end $$;
