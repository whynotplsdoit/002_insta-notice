-- 사용 행동 기록 (관리자 화면 "통계" 탭)
-- 사용법: Supabase 대시보드 → SQL Editor → 이 파일 내용 전체 붙여넣기 → Run (여러 번 실행해도 안전)
--
-- 개인을 알아볼 수 있는 정보(이름, 이메일, IP)는 남기지 않습니다.
-- 브라우저마다 무작위 번호(visitor_id)만 붙여서 같은 방문자인지 구분합니다.
-- 웹 화면은 기록을 "넣기"만 가능하고, 읽기는 관리자만 가능합니다. 180일 지나면 크롤러가 지웁니다.

create table if not exists public.events (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  visitor_id  text not null,           -- 브라우저별 무작위 번호
  session_id  text not null,           -- 방문(탭)별 무작위 번호
  type        text not null,           -- 기록 종류 (아래 목록)
  target      text,                    -- 대상 (글 코드, 매장 아이디, 검색어, 탭 이름 등)
  meta        jsonb,                   -- 덧붙일 정보
  device      text,                    -- mobile / tablet / pc
  constraint events_type_check check (type in (
    'visit',          -- 사이트 방문
    'insta_click',    -- 인스타그램 버튼 (글)
    'shop_open',      -- 매장 정보 창 열기
    'shop_only',      -- 이 매장 소식만 보기
    'map_click',      -- 네이버 지도 버튼
    'phone_click',    -- 전화 버튼
    'search',         -- 검색어
    'tab',            -- 분류 탭 바꾸기
    'sort',           -- 정렬 바꾸기
    'filter',         -- 필터 사용 (종류·지역·매장·끝난 행사 숨기기)
    'more',           -- 본문 더보기
    'new_posts',      -- 새 소식 버튼
    'request_open',   -- 매장 추가 신청 창 열기
    'request_submit'  -- 매장 추가 신청 완료
  )),
  constraint events_lengths check (
    char_length(visitor_id) <= 64 and char_length(session_id) <= 64
    and (target is null or char_length(target) <= 100)
    and (device is null or char_length(device) <= 10)
    and (meta is null or pg_column_size(meta) <= 2000)
  )
);
create index if not exists events_created_idx on public.events (created_at desc);
create index if not exists events_type_idx on public.events (type, created_at desc);

alter table public.events enable row level security;
grant insert on public.events to anon, authenticated;
grant select on public.events to authenticated;
grant all on public.events to service_role;

drop policy if exists "누구나 기록" on public.events;
create policy "누구나 기록" on public.events for insert to anon, authenticated with check (true);
drop policy if exists "관리자 읽기" on public.events;
create policy "관리자 읽기" on public.events for select to authenticated using (public.is_admin());
