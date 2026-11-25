-- 의견 자동 필터링 (스팸함 + 자동 태그)
-- 사용법: Supabase 대시보드 → SQL Editor → 이 파일 내용 전체 붙여넣기 → Run (여러 번 실행해도 안전)
-- 먼저 실행돼 있어야 하는 것: 11-feedback.sql, 14-feedback-status.sql
--
-- 바뀌는 것
--   - 의견은 이제 웹 화면이 직접 넣지 않고 검사 서버(web/api/feedback.js)가 검사한 뒤 넣음
--     (공개 키로 바로 넣는 길을 막아서 검사를 건너뛸 수 없게)
--   - status 에 'spam' 추가: 자동으로 걸러진 의견. 관리자 화면 "스팸함"에서 복원·삭제, 30일 뒤 크롤러가 자동 삭제
--   - tag: AI가 붙인 분류 (매장제보 / 버그신고 / 기능건의 / 정보수정 / 기타)
--   - filter_note: 왜 그렇게 판정했는지 한 줄
--   - sender: 보낸 브라우저별 무작위 번호 (연속 전송 막기용, 개인정보 아님)

alter table public.feedback add column if not exists tag text;
alter table public.feedback add column if not exists filter_note text;
alter table public.feedback add column if not exists sender text;

alter table public.feedback drop constraint if exists feedback_status_check;
alter table public.feedback add constraint feedback_status_check check (status in ('new', 'kept', 'spam'));

alter table public.feedback drop constraint if exists feedback_tag_check;
alter table public.feedback add constraint feedback_tag_check check (tag is null or tag in ('매장제보', '버그신고', '기능건의', '정보수정', '기타'));

alter table public.feedback drop constraint if exists feedback_extra_lengths;
alter table public.feedback add constraint feedback_extra_lengths check (
  (filter_note is null or char_length(filter_note) <= 300) and (sender is null or char_length(sender) <= 64)
);

create index if not exists feedback_sender_idx on public.feedback (sender, created_at desc);

-- 웹 화면(공개 키)에서 바로 넣기 금지 → 검사 서버(비밀 키)만 넣을 수 있음
drop policy if exists "누구나 보내기" on public.feedback;
revoke insert on public.feedback from anon, authenticated;
