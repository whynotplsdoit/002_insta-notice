-- 굿즈레이더 DB 표 만들기
-- 사용법: Supabase 대시보드 → SQL Editor → New query → 이 파일 내용 전체 붙여넣기 → Run
-- 여러 번 실행해도 안전합니다 (이미 있으면 건너뜀).

-- ---------- 매장 ----------
create table if not exists public.accounts (
  username              text primary key,           -- 인스타 아이디 (예: shirostore_hongdae)
  display_name          text not null,              -- 화면에 보일 이름 (예: 시로상점)
  account_type          text not null default '굿즈샵', -- 굿즈샵 / 콜라보카페
  crawl_interval_hours  int  not null default 6,    -- 수집 간격
  last_crawled_at       timestamptz,                -- 마지막 수집 시각
  created_at            timestamptz not null default now()
);

-- ---------- 지점 ----------
create table if not exists public.branches (
  id                bigint generated always as identity primary key,
  account_username  text not null references public.accounts(username) on delete cascade,
  name              text not null,                  -- 예: 홍대점
  region            text,                           -- 예: 홍대, 대구
  address           text,
  unique (account_username, name)
);

-- ---------- 게시물 ----------
create table if not exists public.posts (
  code              text primary key,               -- 인스타 게시물 코드 (주소의 /p/코드/)
  account_username  text not null references public.accounts(username) on delete cascade,
  url               text not null,
  posted_at         timestamptz not null,           -- 인스타에 올린 시각
  media_type        text,                           -- 사진 / 동영상 / 여러 장
  pinned            boolean not null default false,
  caption           text,
  category          text not null default '기타',    -- 입고 / 콜라보·팝업 / 이벤트·안내 / 기타
  goods_type        text[] not null default '{}',   -- 쿠지, 가챠, 피규어, 굿즈
  works             text[] not null default '{}',   -- 작품 이름
  branches          text[] not null default '{}',   -- 지점 이름
  starts_at         timestamptz,                    -- 행사·발매 시작
  ends_at           timestamptz,                    -- 행사 종료
  image_path        text,                           -- 저장소(post-images)에 올린 사진 경로
  first_seen_at     timestamptz not null default now(), -- 우리가 처음 수집한 시각
  updated_at        timestamptz not null default now()
);

create index if not exists posts_posted_at_idx on public.posts (posted_at desc);
create index if not exists posts_category_idx  on public.posts (category, posted_at desc);
create index if not exists posts_account_idx   on public.posts (account_username, posted_at desc);
create index if not exists posts_works_idx     on public.posts using gin (works);

-- ---------- 작품 사전 ----------
create table if not exists public.works (
  name     text primary key,
  aliases  text[] not null default '{}'
);

-- ---------- 접근 권한 ----------
-- 웹 화면(공개 키)은 읽기만, 쓰기는 크롤러(비밀 키)만 가능
alter table public.accounts enable row level security;
alter table public.branches enable row level security;
alter table public.posts    enable row level security;
alter table public.works    enable row level security;

grant usage on schema public to anon, authenticated, service_role;
grant select on public.accounts, public.branches, public.posts, public.works to anon, authenticated;
grant all    on public.accounts, public.branches, public.posts, public.works to service_role;

drop policy if exists "누구나 읽기" on public.accounts;
drop policy if exists "누구나 읽기" on public.branches;
drop policy if exists "누구나 읽기" on public.posts;
drop policy if exists "누구나 읽기" on public.works;
create policy "누구나 읽기" on public.accounts for select to anon, authenticated using (true);
create policy "누구나 읽기" on public.branches for select to anon, authenticated using (true);
create policy "누구나 읽기" on public.posts    for select to anon, authenticated using (true);
create policy "누구나 읽기" on public.works    for select to anon, authenticated using (true);

-- ---------- 실시간 갱신 ----------
-- 새 게시물이 들어오면 웹 화면에 바로 알림
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'posts'
  ) then
    alter publication supabase_realtime add table public.posts;
  end if;
end $$;

-- ---------- 사진 저장소 ----------
-- 인스타 사진 주소는 시간이 지나면 만료되므로 우리 저장소에 복사해 둠 (누구나 볼 수 있음)
insert into storage.buckets (id, name, public)
values ('post-images', 'post-images', true)
on conflict (id) do nothing;
