-- 21. 쓰레드 토큰 보관 (슬랙 봇 @goods-radar 쓰레드 + PC 명령 npm run threads:post 가 같이 씀)
-- Supabase → SQL Editor 에서 한 번 실행
-- 웹 화면(공개 키)에서는 읽을 수 없음. 60일짜리 토큰이라 슬랙에서 쓸 때 7일마다 자동 갱신.

create table if not exists public.sns_tokens (
  platform      text primary key,          -- 'threads'
  access_token  text not null,
  user_id       text not null,
  expires_at    timestamptz,
  refreshed_at  timestamptz not null default now()
);
alter table public.sns_tokens enable row level security;
revoke all on public.sns_tokens from anon, authenticated;
grant all on public.sns_tokens to service_role;
