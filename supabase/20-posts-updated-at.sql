-- 20. 글이 바뀔 때마다 updated_at 을 자동으로 지금 시각으로
-- 사이트가 지난번 데이터를 브라우저에 저장해 두고 "updated_at 이 바뀐 글만" 다시 받기 때문에,
-- 관리자 화면·슬랙 버튼으로 분류를 바꿔도 방문자 화면에 반영되게 하려고 필요합니다.
-- (크롤러는 이제 내용이 바뀐 글만 저장하므로 쓸데없이 바뀌지 않음)

create or replace function public.touch_posts_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists posts_touch_updated_at on public.posts;
create trigger posts_touch_updated_at
  before update on public.posts
  for each row
  execute function public.touch_posts_updated_at();
