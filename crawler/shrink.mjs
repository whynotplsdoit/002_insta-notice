// 사진 줄이기: 인스타 원본(보통 1080px, 200KB 안팎)을 webp 로 작게 만들어 Supabase 전송량을 아낌
// 글 사진은 폭 720px(휴대폰 2배 화면 기준), 프로필 사진은 200px.
import sharp from 'sharp'

export const POST_WIDTH = 720
export const PROFILE_WIDTH = 200

// 이미지 버퍼 → 줄인 webp 버퍼. 원본보다 작으면 키우지 않음
export async function shrinkImage(buffer, width = POST_WIDTH) {
  return sharp(buffer, { failOn: 'none' })
    .rotate() // 사진 방향 정보 반영
    .resize({ width, height: width, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 72, effort: 4 })
    .toBuffer()
}

// 저장 경로는 매번 같은 이름이라 브라우저가 오래 저장해 둬도 됨 (프로필은 ?v= 로 새로 받음)
export const CACHE_SECONDS = String(60 * 60 * 24 * 365)
