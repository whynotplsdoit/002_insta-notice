-- 아침 7시 알림 v3: 지난 24시간 동안 관리자 화면에서 바뀐 값을 모두 보고 (0인 항목은 빼고)
-- 사용법: Supabase 대시보드 → SQL Editor → 이 파일 내용 전체 붙여넣기 → Run (여러 번 실행해도 안전)
-- 먼저 실행돼 있어야 하는 것: 12-daily-report.sql, 17-feedback-filter.sql
--
-- 알림 예시
--   [굿즈레이더] ☀️ 어제 바뀐 것 (11/25 07시 ~ 11/26 07시)
--   📥 매장 신청: 새 신청 2 · 추가 1곳 · 거절 1 · 추가 실패 1
--      👀 지금 확인 필요 1건
--   💬 의견: 새 의견 2 · 걸러진 스팸 3 (안 읽은 의견 3)
--   📝 기타 검토: 새로 들어옴 4 (지금 대기 5)
--   🏪 매장: 10곳 → 11곳 · 숨김 0 → 1
--   🔄 수집: 새 글 18 · 지운 글 6 · 오류·경고 2건 · ⚠️ 인스타 로그인 풀림
--   📊 통계: 방문자 35명 · 방문 52 · 인스타 클릭 40 · 매장 정보 12 …
-- 모두 0이고 확인할 것도 없으면 보내지 않음. 바로 시험: select public.daily_report(true);
-- (시험 실행은 매장 수 기록(daily_snapshots)을 저장하지 않음)

-- 매장 수를 날마다 저장해 두고 다음 날 비교 (관리자가 숨기거나 지운 것도 잡기 위해)
create table if not exists public.daily_snapshots (
  day           date primary key,        -- 알림을 보낸 날 (한국 날짜)
  shops_shown   int not null,
  shops_hidden  int not null,
  created_at    timestamptz not null default now()
);
alter table public.daily_snapshots enable row level security;
grant all on public.daily_snapshots to service_role;

create or replace function public.daily_report(force boolean default false)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_end timestamptz := (((now() at time zone 'Asia/Seoul')::date + time '07:00') at time zone 'Asia/Seoul');
  v_start timestamptz;
  v_day date;
  -- 매장 신청
  n_req_new int; n_added int; n_rejected int; n_req_failed int; n_waiting int;
  -- 의견
  n_fb int; n_spam int; n_fb_unread int;
  -- 기타 검토
  n_review_new int; n_review_now int;
  -- 매장
  n_shown int; n_hidden int; prev record; has_prev boolean;
  -- 수집
  n_posts int; n_deleted int; n_problems int; login_broken boolean;
  -- 통계
  n_visitors int; stats text;
  lines text[] := '{}';
  part text[];
  body text;
  link text;
  slack_url text := public.watchdog_secret('slack_webhook_url');
begin
  if v_end > now() then v_end := v_end - interval '1 day'; end if; -- 7시 전에 직접 실행한 경우
  v_start := v_end - interval '1 day';
  v_day := (v_end at time zone 'Asia/Seoul')::date;

  -- 📥 매장 신청 (추가 완료된 신청은 바로 지워지므로 수집 기록으로 셈)
  select count(distinct account_username) into n_req_new from public.crawl_logs
    where message like '🔎 매장 신청 @%' and message not like '%자동 검토 실패%' and created_at >= v_start and created_at < v_end;
  n_req_new := n_req_new + (select count(*) from public.shop_requests
    where auto_checked_at is null and created_at >= v_start and created_at < v_end);
  select count(*) into n_added from public.crawl_logs
    where message like '🏪 %추가 완료%' and created_at >= v_start and created_at < v_end;
  select count(*) into n_rejected from public.shop_requests
    where status = 'rejected' and reviewed_at >= v_start and reviewed_at < v_end;
  select count(*) into n_req_failed from public.crawl_logs
    where message like '✗ 매장 추가 실패%' and created_at >= v_start and created_at < v_end;
  select count(*) into n_waiting from public.shop_requests where status in ('pending', 'failed');

  -- 💬 의견
  select count(*) filter (where status <> 'spam'), count(*) filter (where status = 'spam') into n_fb, n_spam
    from public.feedback where created_at >= v_start and created_at < v_end;
  select count(*) into n_fb_unread from public.feedback where status = 'new';

  -- 📝 기타 검토
  select count(*) into n_review_new from public.posts
    where needs_review and first_seen_at >= v_start and first_seen_at < v_end;
  select count(*) into n_review_now from public.posts where needs_review;

  -- 🏪 매장 (어제 저장한 숫자와 비교)
  select count(*) filter (where not hidden), count(*) filter (where hidden) into n_shown, n_hidden from public.accounts;
  select * into prev from public.daily_snapshots where day < v_day order by day desc limit 1;
  has_prev := found;

  -- 🔄 수집
  select count(*) into n_posts from public.posts where first_seen_at >= v_start and first_seen_at < v_end;
  select count(*) into n_deleted from public.deleted_posts where deleted_at >= v_start and deleted_at < v_end;
  select count(*) into n_problems from public.crawl_logs where level <> 'info' and created_at >= v_start and created_at < v_end;
  select exists (select 1 from public.crawl_logs where message like '%로그인이 풀려%' and created_at >= v_start and created_at < v_end)
    into login_broken;

  -- 📊 통계 (사이트 행동 기록, 많은 순)
  select count(distinct visitor_id) into n_visitors from public.events where created_at >= v_start and created_at < v_end;
  select string_agg(label || ' ' || n, ' · ' order by n desc) into stats from (
    select case type
        when 'visit' then '방문' when 'insta_click' then '인스타 클릭' when 'shop_open' then '매장 정보'
        when 'shop_only' then '매장만 보기' when 'map_click' then '지도' when 'phone_click' then '전화'
        when 'search' then '검색' when 'tab' then '탭' when 'sort' then '정렬' when 'filter' then '필터'
        when 'more' then '더보기' when 'new_posts' then '새 소식' when 'request_open' then '신청 창'
        when 'request_submit' then '신청 완료' else type end as label,
      count(*) as n
    from public.events where created_at >= v_start and created_at < v_end
    group by type
  ) s;

  -- 매장 수 저장 (정기 실행만)
  if not force then
    insert into public.daily_snapshots (day, shops_shown, shops_hidden) values (v_day, n_shown, n_hidden)
      on conflict (day) do update set shops_shown = excluded.shops_shown, shops_hidden = excluded.shops_hidden, created_at = now();
    delete from public.daily_snapshots where day < v_day - 60;
  end if;

  -- 줄 만들기 (0인 항목은 빼고)
  part := '{}';
  if n_req_new > 0 then part := part || ('새 신청 ' || n_req_new); end if;
  if n_added > 0 then part := part || ('추가 ' || n_added || '곳'); end if;
  if n_rejected > 0 then part := part || ('거절 ' || n_rejected); end if;
  if n_req_failed > 0 then part := part || ('추가 실패 ' || n_req_failed); end if;
  if cardinality(part) > 0 or n_waiting > 0 then
    lines := lines || ('📥 매장 신청: ' || coalesce(nullif(array_to_string(part, ' · '), ''), '새 소식 없음')
      || case when n_waiting > 0 then E'\n' || '   👀 지금 확인 필요 ' || n_waiting || '건' else '' end);
  end if;

  part := '{}';
  if n_fb > 0 then part := part || ('새 의견 ' || n_fb); end if;
  if n_spam > 0 then part := part || ('걸러진 스팸 ' || n_spam); end if;
  if cardinality(part) > 0 then
    lines := lines || ('💬 의견: ' || array_to_string(part, ' · ') || case when n_fb_unread > 0 then ' (안 읽은 의견 ' || n_fb_unread || ')' else '' end);
  end if;

  if n_review_new > 0 then
    lines := lines || ('📝 기타 검토: 새로 들어옴 ' || n_review_new || ' (지금 대기 ' || n_review_now || ')');
  end if;

  if has_prev and (prev.shops_shown <> n_shown or prev.shops_hidden <> n_hidden) then
    part := '{}';
    if prev.shops_shown <> n_shown then part := part || (prev.shops_shown || '곳 → ' || n_shown || '곳'); end if;
    if prev.shops_hidden <> n_hidden then part := part || ('숨김 ' || prev.shops_hidden || ' → ' || n_hidden); end if;
    lines := lines || ('🏪 매장: ' || array_to_string(part, ' · '));
  end if;

  part := '{}';
  if n_posts > 0 then part := part || ('새 글 ' || n_posts); end if;
  if n_deleted > 0 then part := part || ('지운 글 ' || n_deleted); end if;
  if n_problems > 0 then part := part || ('오류·경고 ' || n_problems || '건'); end if;
  if login_broken then part := part || '⚠️ 인스타 로그인 풀림'::text; end if;
  if cardinality(part) > 0 then lines := lines || ('🔄 수집: ' || array_to_string(part, ' · ')); end if;

  if n_visitors > 0 then
    lines := lines || ('📊 통계: 방문자 ' || n_visitors || '명' || coalesce(' · ' || stats, ''));
  end if;

  if not force and cardinality(lines) = 0 then return; end if;

  body := '[굿즈레이더] ☀️ 어제 바뀐 것 ('
    || to_char(v_start at time zone 'Asia/Seoul', 'FMMM/FMDD HH24') || '시 ~ '
    || to_char(v_end at time zone 'Asia/Seoul', 'FMMM/FMDD HH24') || '시)' || E'\n\n'
    || coalesce(nullif(array_to_string(lines, E'\n'), ''), '바뀐 것이 없습니다.');
  -- 확인할 게 있는 탭으로 (신청 > 의견 > 기타 검토 > 수집 문제 > 첫 화면)
  link := 'https://goods-radar-xi.vercel.app/admin' || case
    when n_waiting > 0 then '?tab=requests'
    when n_fb_unread > 0 then '?tab=feedback'
    when n_review_now > 0 then '?tab=review'
    when n_problems > 0 or login_broken then '?tab=status'
    else '' end;

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
