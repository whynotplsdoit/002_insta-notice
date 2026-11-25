-- 매장 신청에 지도 링크(네이버·카카오) 칸 추가
-- 사용법: Supabase 대시보드 → SQL Editor → 이 파일 내용 전체 붙여넣기 → Run (여러 번 실행해도 안전)
--
-- 신청자가 선택으로 적는 칸. 관리자가 바로 열어 보고, 네이버 링크면 자동 검토가 그 매장을 먼저 확인함.

alter table public.shop_requests add column if not exists map_url text;

-- 네이버·카카오 지도 주소만, 300자까지
alter table public.shop_requests drop constraint if exists shop_requests_map_url_check;
alter table public.shop_requests add constraint shop_requests_map_url_check check (
  map_url is null or (
    char_length(map_url) <= 300
    and map_url ~* '^https?://([a-z0-9-]+\.)*(naver\.me|naver\.com|kko\.to|kakao\.com)(/|$)'
  )
);
