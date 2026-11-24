-- PC가 꺼져도 알림: Supabase 안에서 20분마다 "자동 수집이 멈췄는지" 확인하고 슬랙으로 알림
-- 사용법: Supabase 대시보드 → SQL Editor → 이 파일 내용 전체 붙여넣기 → Run (여러 번 실행해도 안전)
--
-- 미리 할 일 (한 번만, 이 파일과 따로 실행):
--   슬랙 웹후크 주소를 Supabase 금고(Vault)에 저장. 주소는 이 파일이나 GitHub에 남기지 않습니다.
--   select vault.create_secret('여기에_슬랙_웹후크_주소', 'slack_webhook_url');
--
-- 확인 규칙
--   - 한국 시각 10시~24시에만 확인 (밤에는 원래 수집하지 않음)
--   - 마지막 "피드 확인" 기록이 60분 넘게 없으면 → ⚠️ 알림 (계속 멈춰 있으면 2시간마다 다시)
--   - 다시 기록이 생기면 → ✅ 복구 알림

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- 마지막으로 알린 상태 (웹 화면에서는 읽을 수 없음)
create table if not exists public.watchdog_state (
  id             int primary key default 1,
  alerting       boolean not null default false,
  last_alert_at  timestamptz
);
alter table public.watchdog_state enable row level security;
insert into public.watchdog_state (id) values (1) on conflict do nothing;

-- 슬랙으로 보내기
create or replace function public.watchdog_send(msg text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  url text;
begin
  select decrypted_secret into url from vault.decrypted_secrets where name = 'slack_webhook_url' limit 1;
  if url is null then
    raise notice '슬랙 웹후크 주소가 금고에 없습니다 (slack_webhook_url)';
    return;
  end if;
  perform net.http_post(
    url := url,
    body := jsonb_build_object('text', '[굿즈레이더] ' || msg),
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
end;
$$;

-- 수집이 멈췄는지 확인
create or replace function public.watchdog_check()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  kst_hour int := extract(hour from now() at time zone 'Asia/Seoul');
  last_run timestamptz;
  st public.watchdog_state;
  stale boolean;
begin
  select max(created_at) into last_run from public.crawl_logs where message like '피드 확인%';
  select * into st from public.watchdog_state where id = 1;
  stale := last_run is null or last_run < now() - interval '60 minutes';

  if kst_hour >= 10 and stale then
    if not st.alerting or st.last_alert_at < now() - interval '2 hours' then
      perform public.watchdog_send(
        '⚠️ 1시간 넘게 자동 수집 기록이 없습니다. (마지막 수집: '
        || coalesce(to_char(last_run at time zone 'Asia/Seoul', 'MM.DD HH24:MI'), '없음') || ')'
        || E'\nPC가 꺼졌거나, 작업 스케줄러가 멈췄거나, 인스타 로그인이 풀렸는지 확인해 주세요.'
      );
      update public.watchdog_state set alerting = true, last_alert_at = now() where id = 1;
    end if;
  elsif st.alerting and not stale then
    perform public.watchdog_send('✅ 자동 수집이 다시 동작합니다.');
    update public.watchdog_state set alerting = false where id = 1;
  end if;
end;
$$;

-- 웹 화면(공개 키)에서는 이 함수들을 부를 수 없게
revoke all on function public.watchdog_send(text) from public, anon, authenticated;
revoke all on function public.watchdog_check() from public, anon, authenticated;

-- 20분마다 실행 (같은 이름이 있으면 바꿈)
select cron.schedule('goods-radar-watchdog', '*/20 * * * *', $$select public.watchdog_check()$$);
