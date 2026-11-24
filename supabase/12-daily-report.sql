-- 매일 아침 7시(한국 시각): 지난 24시간 동안 새로 온 매장 신청·의견 수를 슬랙 + 카톡으로 알림
-- 사용법: Supabase 대시보드 → SQL Editor → 이 파일 내용 전체 붙여넣기 → Run (여러 번 실행해도 안전)
-- 먼저 실행돼 있어야 하는 것: 09-watchdog.sql (카톡·슬랙 보내기), 11-feedback.sql (의견 표)
--
-- 새로 온 게 없고 확인을 기다리는 신청도 없으면 보내지 않습니다.
-- 매장 신청은 PC 크롤러가 자동 검토(13-auto-review.sql)해서 추가·거절하고, 애매한 것만 '확인 필요'로 남깁니다.
-- 바로 시험해 보기: select public.daily_report(true);   (0건이어도 보냄)

create or replace function public.daily_report(force boolean default false)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  -- 어제 아침 7시 ~ 오늘 아침 7시 (한국 시각)
  v_end timestamptz := (((now() at time zone 'Asia/Seoul')::date + time '07:00') at time zone 'Asia/Seoul');
  v_start timestamptz;
  n_req int;
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

  select count(*),
         count(*) filter (where status in ('approved', 'done')),
         count(*) filter (where status = 'rejected')
    into n_req, n_added, n_rejected
    from public.shop_requests where created_at >= v_start and created_at < v_end;
  -- 언제 들어왔든 지금 관리자 확인을 기다리는 신청 (대기·추가 실패)
  select count(*) into n_waiting from public.shop_requests where status in ('pending', 'failed');
  select count(*) into n_fb from public.feedback where created_at >= v_start and created_at < v_end;
  if not force and n_req = 0 and n_fb = 0 and n_waiting = 0 then return; end if;

  body := '[굿즈레이더] ☀️ 어제 들어온 소식' || E'\n'
    || '매장 신청 ' || n_req || '건'
    || case when n_req > 0 then ' (추가 ' || n_added || ' · 거절 ' || n_rejected || ')' else '' end
    || ' · 의견 ' || n_fb || '건'
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

-- 매일 한국 시각 7시 = 세계 표준시 22시 (같은 이름이 있으면 바꿈)
select cron.schedule('goods-radar-daily-report', '0 22 * * *', $$select public.daily_report()$$);
