// 웹 화면용 Supabase 연결 (공개 키)
// - 일반 사용자: 로그인 없이 읽기만 가능
// - 관리자(/admin): 이메일 링크로 로그인하면 수정 가능 (권한은 DB가 확인)
import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.SUPABASE_URL
const key = import.meta.env.SUPABASE_PUBLISHABLE_KEY

export const configured = Boolean(url && key)

export const supabase = configured
  ? createClient(url, key, { auth: { persistSession: true, storageKey: 'goods-radar-auth' } })
  : null

export const imageUrl = (path) =>
  path && supabase ? supabase.storage.from('post-images').getPublicUrl(path).data.publicUrl : null

// 목록 카드용 작은 사진 (크롤러 crawler/shrink.mjs 와 같은 규칙: 코드.webp → 코드.t.webp)
export const thumbPath = (path) => (path?.endsWith('.webp') ? path.replace(/.webp$/, '.t.webp') : null)
export const thumbUrl = (path) => imageUrl(thumbPath(path))
// 사진 지울 때 작은 사진도 같이
export const withThumbs = (paths) => paths.filter(Boolean).flatMap((p) => [p, thumbPath(p)].filter(Boolean))
