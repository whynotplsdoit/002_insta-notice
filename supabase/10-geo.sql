-- 지도 보기: 지점 좌표 (네이버 지도에서 주 1회 함께 읽어 옴)
-- 사용법: Supabase 대시보드 → SQL Editor → 이 파일 내용 전체 붙여넣기 → Run (여러 번 실행해도 안전)
alter table public.branches add column if not exists lat double precision; -- 위도
alter table public.branches add column if not exists lng double precision; -- 경도
