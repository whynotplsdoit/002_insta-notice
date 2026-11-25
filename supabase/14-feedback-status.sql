-- 의견 정리 방식 바꾸기: 새 의견 → [보관] 또는 [삭제]
-- 사용법: Supabase 대시보드 → SQL Editor → 이 파일 내용 전체 붙여넣기 → Run (여러 번 실행해도 안전)
--
-- status: new 새 의견 / kept 보관한 의견 (나중에 처리, 끝나면 삭제)

alter table public.feedback drop constraint if exists feedback_status_check;
update public.feedback set status = 'kept' where status not in ('new', 'kept'); -- 예전 "확인함" → 보관
alter table public.feedback add constraint feedback_status_check check (status in ('new', 'kept'));

-- 관리자 화면에서 의견 삭제 (완전히 지움)
grant delete on public.feedback to authenticated;
drop policy if exists "관리자 삭제" on public.feedback;
create policy "관리자 삭제" on public.feedback for delete to authenticated using (public.is_admin());
