-- 의견 보내기 표
-- 사용법: Supabase 대시보드 → SQL Editor → 이 파일 내용 전체 붙여넣기 → Run (여러 번 실행해도 안전)
--
-- 웹 화면(공개 키)은 의견을 "넣기"만 가능하고, 읽기·고치기는 관리자만 할 수 있습니다.
-- 연락처 등 개인정보는 받지 않습니다.

create table if not exists public.feedback (
  id          bigint generated always as identity primary key,
  kind        text not null default '의견',          -- 의견 / 오류 / 정보 수정
  message     text not null,
  context     text,                                  -- 보낸 곳 (예: 탭 이름, 글 코드)
  ua          text,                                  -- 기기·브라우저 (오류 확인용)
  status      text not null default 'new',           -- new 새 의견 / done 확인함
  created_at  timestamptz not null default now(),
  checked_at  timestamptz,
  constraint feedback_kind_check check (kind in ('의견', '오류', '정보 수정')),
  constraint feedback_message_check check (char_length(btrim(message)) between 2 and 1000),
  constraint feedback_context_check check (context is null or char_length(context) <= 200),
  constraint feedback_ua_check check (ua is null or char_length(ua) <= 300),
  constraint feedback_status_check check (status in ('new', 'done'))
);

alter table public.feedback enable row level security;

grant insert on public.feedback to anon, authenticated;
grant select, update on public.feedback to authenticated;
grant all on public.feedback to service_role;

drop policy if exists "누구나 보내기" on public.feedback;
create policy "누구나 보내기" on public.feedback
  for insert to anon, authenticated
  with check (status = 'new' and checked_at is null);

drop policy if exists "관리자 읽기" on public.feedback;
create policy "관리자 읽기" on public.feedback for select to authenticated using (public.is_admin());

drop policy if exists "관리자 수정" on public.feedback;
create policy "관리자 수정" on public.feedback for update to authenticated using (public.is_admin()) with check (public.is_admin());
