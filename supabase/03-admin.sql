-- 관리자 화면용 DB 변경
-- 사용법: Supabase 대시보드 → SQL Editor → 이 파일 내용 전체 붙여넣기 → Run (여러 번 실행해도 안전)
--
-- 1) 관리자 목록과 "관리자인지" 확인하는 함수
-- 2) 매장·지점·글에 관리용 칸 추가 (숨기기, 고정 해시태그, 직접 고친 분류 표시)
-- 3) 수집 기록 표
-- 4) 관리자만 고칠 수 있는 권한, 숨긴 매장·글은 일반 사용자에게 안 보이게

-- ---------- 1. 관리자 ----------
create table if not exists public.admins (
  email       text primary key,
  created_at  timestamptz not null default now()
);
alter table public.admins enable row level security;
grant all on public.admins to service_role;
-- 관리자 추가는 비밀 키로만 (웹에서는 아무도 읽거나 고칠 수 없음)

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where email = lower(auth.jwt() ->> 'email'))
$$;
grant execute on function public.is_admin() to anon, authenticated;

-- ---------- 2. 관리용 칸 ----------
alter table public.accounts add column if not exists fixed_hashtags text[] not null default '{}';
alter table public.accounts add column if not exists hidden boolean not null default false;   -- 숨김: 안 보이고 수집도 안 함
alter table public.branches add column if not exists aliases text[] not null default '{}';     -- 글에서 지점을 알아보는 단어
alter table public.posts    add column if not exists hidden boolean not null default false;   -- 숨긴 글
alter table public.posts    add column if not exists manual boolean not null default false;   -- 관리자가 분류를 직접 고침 (크롤러가 덮어쓰지 않음)

-- 매장 신청: 승인 후 크롤러 처리 단계 추가
alter table public.shop_requests add column if not exists result text;  -- 처리 결과 메시지
alter table public.shop_requests add column if not exists account_type text;
alter table public.shop_requests drop constraint if exists shop_requests_status_check;
alter table public.shop_requests add constraint shop_requests_status_check
  check (status in ('pending', 'approved', 'done', 'failed', 'rejected'));
-- pending 대기 → approved 승인됨(크롤러 처리 대기) → done 추가 완료 / failed 실패,  또는 rejected 거절

-- ---------- 3. 수집 기록 ----------
create table if not exists public.crawl_logs (
  id                bigint generated always as identity primary key,
  created_at        timestamptz not null default now(),
  level             text not null default 'info',  -- info / warn / error
  account_username  text,
  message           text not null
);
create index if not exists crawl_logs_created_idx on public.crawl_logs (created_at desc);
alter table public.crawl_logs enable row level security;
grant all on public.crawl_logs to service_role;
grant select on public.crawl_logs to authenticated;
drop policy if exists "관리자 읽기" on public.crawl_logs;
create policy "관리자 읽기" on public.crawl_logs for select to authenticated using (public.is_admin());

-- ---------- 4. 권한 ----------
-- 읽기: 숨긴 매장·글은 관리자에게만
drop policy if exists "누구나 읽기" on public.accounts;
create policy "누구나 읽기" on public.accounts for select to anon, authenticated
  using (not hidden or public.is_admin());
drop policy if exists "누구나 읽기" on public.posts;
create policy "누구나 읽기" on public.posts for select to anon, authenticated
  using (not hidden or public.is_admin());

-- 고치기: 관리자만
grant update on public.accounts, public.branches, public.posts to authenticated;
grant insert, delete on public.branches to authenticated;
grant delete on public.accounts to authenticated;
drop policy if exists "관리자 수정" on public.accounts;
create policy "관리자 수정" on public.accounts for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "관리자 삭제" on public.accounts;
create policy "관리자 삭제" on public.accounts for delete to authenticated using (public.is_admin());
drop policy if exists "관리자 수정" on public.branches;
create policy "관리자 수정" on public.branches for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "관리자 수정" on public.posts;
create policy "관리자 수정" on public.posts for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- 매장 신청: 관리자는 읽고 고칠 수 있음
grant select, update on public.shop_requests to authenticated;
drop policy if exists "관리자 읽기" on public.shop_requests;
create policy "관리자 읽기" on public.shop_requests for select to authenticated using (public.is_admin());
drop policy if exists "관리자 수정" on public.shop_requests;
create policy "관리자 수정" on public.shop_requests for update to authenticated using (public.is_admin()) with check (public.is_admin());
