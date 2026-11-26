// 관리자: 글 완전 삭제
// 1) 다시 수집되지 않게 기록 → 2) 사진 삭제 → 3) 글 삭제
// 반환: 오류 메시지 (성공하면 null)
import { supabase, withThumbs } from '../supabase.js'

export async function deletePost(post) {
  if (!confirm('이 글을 완전히 삭제할까요?\n글과 사진이 지워지고, 다시 수집되지도 않습니다. 되돌릴 수 없습니다.')) return 'cancel'
  // 이미 기록돼 있으면 그냥 넘어감 (덮어쓰지 않으므로 '넣기' 권한만 필요)
  const rec = await supabase
    .from('deleted_posts')
    .upsert({ code: post.code, account_username: post.account_username }, { onConflict: 'code', ignoreDuplicates: true })
  if (rec.error) return rec.error.message
  if (post.image_path) await supabase.storage.from('post-images').remove(withThumbs([post.image_path]))
  const { error } = await supabase.from('posts').delete().eq('code', post.code)
  return error ? error.message : null
}
