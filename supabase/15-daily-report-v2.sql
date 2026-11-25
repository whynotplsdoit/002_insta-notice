-- 아침 7시 알림 고치기: 추가 완료된 매장 신청은 바로 지우므로 "추가" 수는 수집 기록(🏪 … 추가 완료)으로 셈
-- 사용법: Supabase 대시보드 → SQL Editor → 이 파일 내용 전체 붙여넣기 → Run (여러 번 실행해도 안전)
-- 먼저 실행돼 있어야 하는 것: 12-daily-report.sql
--
-- 알림 내용 (지난 24시간, 어제 아침 7시 ~ 오늘 아침 7시)
--   매장 추가 a곳 · 거절 r건 · 의견 n건
--   👀 확인이 필요한 매장 신청 w건   (언제 들어왔든 지금 대기·추가 실패인 신청)
-- 모두 0이면 보내지 않습니다. 바로 시험: select public.daily_report(true);

create or replace function public.daily_report(force boolean default false)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_end timestamptz := (((now() at time zone 'Asia/Seoul')::date + time '07:00') at time zone 'Asia/Seoul');
  v_start timestamptz;
  n_added int;
  n_rejected int;
  n_waiting int;
  n_fb int;
  body text;
  link text;
  slack_url text := public.watchdog_secret('slack_webhook_url');
begin
  if v_end > now() then v_end := v_end - interval '1 day'; end if; -- 7시 전에 직접 실행한 경우
  v_start := v_end - interval '1 day';

  select count(*) into n_added from public.crawl_logs
    where message like '🏪 %추가 완료%' and created_at >= v_start and created_at < v_end;
  select count(*) into n_rejected from public.shop_requests
    where status = 'rejected' and reviewed_at >= v_start and reviewed_at < v_end;
  select count(*) into n_waiting from public.shop_requests where status in ('pending', 'failed');
  select count(*) into n_fb from public.feedback where created_at >= v_start and created_at < v_end;
  if not force and n_added = 0 and n_rejected = 0 and n_fb = 0 and n_waiting = 0 then return; end if;

  body := '[굿즈레이더] ☀️ 어제 들어온 소식' || E'\n'
    || '매장 추가 ' || n_added || '곳 · 거절 ' || n_rejected || '건 · 의견 ' || n_fb || '건'
    || case when n_waiting > 0 then E'\n' || '👀 확인이 필요한 매장 신청 ' || n_waiting || '건' else '' end;
  link := 'https://goods-radar-xi.vercel.app/admin?tab=' || case when n_waiting = 0 and n_fb > 0 then 'feedback' else 'requests' end;

  -- 슬랙 + 카톡 (한쪽이 실패해도 다른 쪽은 보냄, 실패는 수집 기록에 남김)
  begin
    if slack_url is null then raise exception '금고에 slack_webhook_url 이 없습니다'; end if;
    perform extensions.http_post(slack_url, jsonb_build_object('text', body || E'\n' || link)::text, 'application/json');
  exception when others then
    insert into public.crawl_logs (level, message) values ('error', '✗ 아침 알림(슬랙) 실패: ' || sqlerrm);
  end;
  begin
    perform public.watchdog_kakao(body, link);
  exception when others then
    insert into public.crawl_logs (level, message) values ('error', '✗ 아침 알림(카톡) 실패: ' || sqlerrm);
  end;
end;
$$;

revoke all on function public.daily_report(boolean) from public, anon, authenticated;
