-- '기타' 글 검토: 관리자가 보고 게시하거나 삭제
-- 사용법: Supabase 대시보드 → SQL Editor → 이 파일 내용 전체 붙여넣기 → Run (여러 번 실행해도 안전)
--
-- 크롤러가 '기타'로 분류한 새 글은 숨김 + 검토 대기 상태로 들어옵니다.
-- 관리자 화면 "기타 검토" 탭에서 [게시] 하면 사이트에 보이고, [삭제] 하면 완전히 지워집니다.

-- 1) 검토 대기 표시
alter table public.posts add column if not exists needs_review boolean not null default false;

-- 지금 있는 '기타' 글을 검토 대기로 (관리자가 직접 고친 글은 제외)
update public.posts set needs_review = true, hidden = true
where category = '기타' and not manual and not needs_review;

-- 2) 관리자가 글을 완전히 삭제할 수 있게
grant delete on public.posts to authenticated;
drop policy if exists "관리자 삭제" on public.posts;
create policy "관리자 삭제" on public.posts for delete to authenticated using (public.is_admin());

-- 지운 글 기록 (다시 수집되지 않도록)
grant select, insert on public.deleted_posts to authenticated;
drop policy if exists "관리자 기록" on public.deleted_posts;
create policy "관리자 기록" on public.deleted_posts for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- 사진 저장소에서 사진 삭제
drop policy if exists "관리자 사진 삭제" on storage.objects;
create policy "관리자 사진 삭제" on storage.objects for delete to authenticated
  using (bucket_id = 'post-images' and public.is_admin());
