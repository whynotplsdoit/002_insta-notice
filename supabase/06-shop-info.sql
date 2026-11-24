-- 매장 정보: 인스타 프로필 + 네이버 지도(지점별)
-- 사용법: Supabase 대시보드 → SQL Editor → 이 파일 내용 전체 붙여넣기 → Run (여러 번 실행해도 안전)

-- 매장(인스타 계정) 정보: 크롤러가 매장 페이지를 열 때마다 갱신
alter table public.accounts add column if not exists ig_full_name       text;         -- 인스타 프로필 이름
alter table public.accounts add column if not exists bio                text;         -- 소개글
alter table public.accounts add column if not exists external_url       text;         -- 소개 링크
alter table public.accounts add column if not exists profile_image_path text;         -- 저장소(post-images)의 프로필 사진 경로
alter table public.accounts add column if not exists profile_updated_at timestamptz;

-- 지점 정보: 네이버 지도에서 일주일에 한 번 갱신
alter table public.branches add column if not exists naver_place_id   text;           -- 네이버 플레이스 번호
alter table public.branches add column if not exists naver_name       text;           -- 네이버에 등록된 이름
alter table public.branches add column if not exists naver_category   text;
alter table public.branches add column if not exists phone            text;
alter table public.branches add column if not exists directions       text;           -- 찾아오는 길
alter table public.branches add column if not exists hours            jsonb;          -- [{day:'월', start:'11:00', end:'20:00', breaks:[], note}]
alter table public.branches add column if not exists closed_regular   text;           -- 정기 휴무 (예: 매주 화요일)
alter table public.branches add column if not exists closed_coming    text[] not null default '{}'; -- 다가오는 임시 휴무
alter table public.branches add column if not exists hours_note       text;           -- 영업시간 메모
alter table public.branches add column if not exists info_manual      boolean not null default false; -- 관리자가 직접 입력 → 네이버 갱신이 주소·전화·영업시간을 덮어쓰지 않음
alter table public.branches add column if not exists naver_updated_at timestamptz;
