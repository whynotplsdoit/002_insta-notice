-- 매장 신청 자동 검토: PC 크롤러가 인스타·네이버를 확인한 결과를 저장할 칸
-- 사용법: Supabase 대시보드 → SQL Editor → 이 파일 내용 전체 붙여넣기 → Run (여러 번 실행해도 안전)

alter table public.shop_requests add column if not exists auto_checked_at timestamptz;              -- 자동 검토한 시각
alter table public.shop_requests add column if not exists auto_note text;                           -- 자동 검토 결과 설명
alter table public.shop_requests add column if not exists auto_approved boolean not null default false; -- 자동으로 승인했는지
alter table public.shop_requests add column if not exists naver_place_id text;                      -- 찾은 네이버 플레이스 번호

-- 웹 화면(공개 키)에서는 이 칸들을 채워서 신청할 수 없게
drop policy if exists "누구나 신청" on public.shop_requests;
create policy "누구나 신청" on public.shop_requests
  for insert to anon, authenticated
  with check (
    status = 'pending' and reviewed_at is null
    and auto_checked_at is null and auto_note is null and auto_approved = false and naver_place_id is null
  );
