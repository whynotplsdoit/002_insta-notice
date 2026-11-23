-- 끝난 행사 자동 삭제용
-- 사용법: Supabase 대시보드 → SQL Editor → 이 파일 내용 전체 붙여넣기 → Run (여러 번 실행해도 안전)
--
-- 끝난 지 7일이 지난 글은 크롤러가 posts 표와 사진 저장소에서 완전히 지웁니다.
-- 지운 글의 인스타 게시물 코드만 여기에 남겨서, 다음 수집 때 같은 글이 다시 들어오지 않게 합니다.
-- (관리자·크롤러 전용. 웹 화면에서는 읽을 수 없음)

create table if not exists public.deleted_posts (
  code              text primary key,          -- 인스타 게시물 코드
  account_username  text,
  deleted_at        timestamptz not null default now()
);
alter table public.deleted_posts enable row level security;
grant all on public.deleted_posts to service_role;
