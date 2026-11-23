-- 매장 추가 신청 표
-- 사용법: Supabase 대시보드 → SQL Editor → 이 파일 내용 전체 붙여넣기 → Run (여러 번 실행해도 안전)
--
-- 웹 화면(공개 키)은 신청을 "넣기"만 가능하고, 다른 사람의 신청을 읽거나 고칠 수 없습니다.
-- 승인·거절은 관리자가 크롤러(비밀 키)로 처리합니다.

create table if not exists public.shop_requests (
  id            bigint generated always as identity primary key,
  username      text not null,                    -- 인스타 아이디 (소문자)
  display_name  text,                             -- 신청자가 적은 매장 이름
  region        text,                             -- 신청자가 적은 지역 (예: 홍대)
  note          text,                             -- 하고 싶은 말
  status        text not null default 'pending',  -- pending 대기 / approved 승인 / rejected 거절
  created_at    timestamptz not null default now(),
  reviewed_at   timestamptz,
  -- 잘못된 값이 들어오지 않도록 검사
  constraint shop_requests_username_check check (username ~ '^[a-z0-9._]{1,30}$'),
  constraint shop_requests_display_name_check check (display_name is null or char_length(display_name) <= 40),
  constraint shop_requests_region_check check (region is null or char_length(region) <= 20),
  constraint shop_requests_note_check check (note is null or char_length(note) <= 300),
  constraint shop_requests_status_check check (status in ('pending', 'approved', 'rejected'))
);

-- 같은 매장을 여러 번 신청해도 대기 중인 신청은 하나만
create unique index if not exists shop_requests_pending_unique
  on public.shop_requests (username) where status = 'pending';

alter table public.shop_requests enable row level security;

grant insert on public.shop_requests to anon, authenticated;
grant all on public.shop_requests to service_role;

drop policy if exists "누구나 신청" on public.shop_requests;
create policy "누구나 신청" on public.shop_requests
  for insert to anon, authenticated
  with check (status = 'pending' and reviewed_at is null);
