-- PC가 꺼져도 알림: Supabase 안에서 20분마다 "자동 수집이 멈췄는지" 확인하고 슬랙 + 카톡으로 알림
-- 사용법: Supabase 대시보드 → SQL Editor → 이 파일 내용 전체 붙여넣기 → Run (여러 번 실행해도 안전)
--
-- 미리 할 일 (한 번만, 이 파일과 따로 실행. 실행 후 쿼리를 저장하지 말고 닫기):
--   select vault.create_secret('슬랙_웹후크_주소', 'slack_webhook_url');
--   select vault.create_secret('카카오_REST_API_키', 'kakao_rest_api_key');
--   키와 주소는 Supabase 금고(Vault)에만 저장되고 이 파일이나 GitHub에는 남지 않습니다.
--
-- 확인 규칙
--   - 한국 시각 10시~24시에만 확인 (밤에는 원래 수집하지 않음)
--   - 마지막 "피드 확인" 기록이 60분 넘게 없으면 → ⚠️ 알림 (계속 멈춰 있으면 2시간마다 다시)
--   - 다시 기록이 생기면 → ✅ 복구 알림
--
-- 카톡 토큰은 kakao_tokens 표에 두고 PC 크롤러와 함께 씁니다 (PC가 꺼져 있어도 여기서 갱신·발송).

create extension if not exists pg_cron;
create extension if not exists http with schema extensions;

-- ---------- 카카오 토큰 (PC 크롤러와 공유, 웹 화면에서는 접근 불가) ----------
create table if not exists public.kakao_tokens (
  id                  int primary key default 1,
  access_token        text,
  access_expires_at   timestamptz,
  refresh_token       text,
  refresh_expires_at  timestamptz,
  updated_at          timestamptz not null default now()
);
alter table public.kakao_tokens enable row level security;
grant all on public.kakao_tokens to service_role;

-- ---------- 감시 상태 ----------
create table if not exists public.watchdog_state (
  id             int primary key default 1,
  alerting       boolean not null default false,
  last_alert_at  timestamptz
);
alter table public.watchdog_state enable row level security;
insert into public.watchdog_state (id) values (1) on conflict do nothing;

-- ---------- 금고에서 값 꺼내기 ----------
create or replace function public.watchdog_secret(secret_name text)
returns text
language sql
security definer
set search_path = public
as $$
  select decrypted_secret from vault.decrypted_secrets where name = secret_name limit 1
$$;

-- ---------- 카톡 나에게 보내기 ----------
create or replace function public.watchdog_kakao(msg text, link text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  rest_key text := public.watchdog_secret('kakao_rest_api_key');
  t public.kakao_tokens;
  resp extensions.http_response;
  j jsonb;
  template jsonb;
begin
  if rest_key is null then raise exception '금고에 kakao_rest_api_key 가 없습니다'; end if;
  select * into t from public.kakao_tokens where id = 1;
  if t.refresh_token is null then raise exception '카톡 토큰이 없습니다 (PC에서 npm run kakao:login)'; end if;

  -- 접근 토큰이 10분 안에 만료되면 갱신
  if t.access_token is null or t.access_expires_at < now() + interval '10 minutes' then
    resp := extensions.http_post(
      'https://kauth.kakao.com/oauth/token',
      'grant_type=refresh_token&client_id=' || extensions.urlencode(rest_key)
        || '&refresh_token=' || extensions.urlencode(t.refresh_token),
      'application/x-www-form-urlencoded'
    );
    j := resp.content::jsonb;
    if resp.status <> 200 then raise exception '카톡 토큰 갱신 실패: %', coalesce(j->>'error_description', resp.status::text); end if;
    update public.kakao_tokens set
      access_token = j->>'access_token',
      access_expires_at = now() + make_interval(secs => (j->>'expires_in')::int),
      refresh_token = coalesce(j->>'refresh_token', refresh_token),
      refresh_expires_at = case when j ? 'refresh_token_expires_in'
        then now() + make_interval(secs => (j->>'refresh_token_expires_in')::int) else refresh_expires_at end,
      updated_at = now()
    where id = 1
    returning * into t;
  end if;

  template := jsonb_build_object(
    'object_type', 'text',
    'text', left(msg, 200),
    'link', jsonb_build_object('web_url', link, 'mobile_web_url', link),
    'button_title', '굿즈레이더 열기'
  );
  resp := extensions.http((
    'POST',
    'https://kapi.kakao.com/v2/api/talk/memo/default/send',
    array[extensions.http_header('Authorization', 'Bearer ' || t.access_token)],
    'application/x-www-form-urlencoded',
    'template_object=' || extensions.urlencode(template::text)
  )::extensions.http_request);
  if resp.status <> 200 then raise exception '카톡 보내기 실패: %', resp.content; end if;
end;
$$;

-- ---------- 슬랙 + 카톡 함께 보내기 (한쪽이 실패해도 다른 쪽은 보냄, 실패는 수집 기록에 남김) ----------
create or replace function public.watchdog_send(msg text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  body text := '[굿즈레이더] ' || msg;
  link text := 'https://goods-radar-xi.vercel.app/admin?tab=status';
  slack_url text := public.watchdog_secret('slack_webhook_url');
begin
  begin
    if slack_url is null then raise exception '금고에 slack_webhook_url 이 없습니다'; end if;
    perform extensions.http_post(slack_url, jsonb_build_object('text', body)::text, 'application/json');
  exception when others then
    insert into public.crawl_logs (level, message) values ('error', '✗ 감시 알림(슬랙) 실패: ' || sqlerrm);
  end;
  begin
    perform public.watchdog_kakao(body, link);
  exception when others then
    insert into public.crawl_logs (level, message) values ('error', '✗ 감시 알림(카톡) 실패: ' || sqlerrm);
  end;
end;
$$;

-- ---------- 수집이 멈췄는지 확인 ----------
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
revoke all on function public.watchdog_secret(text) from public, anon, authenticated;
revoke all on function public.watchdog_kakao(text, text) from public, anon, authenticated;
revoke all on function public.watchdog_send(text) from public, anon, authenticated;
revoke all on function public.watchdog_check() from public, anon, authenticated;

-- 20분마다 실행 (같은 이름이 있으면 바꿈)
select cron.schedule('goods-radar-watchdog', '*/20 * * * *', $$select public.watchdog_check()$$);
