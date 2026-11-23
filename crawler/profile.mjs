import path from 'node:path'
import os from 'node:os'

// 로그인 상태(쿠키)를 저장하는 브라우저 프로필 폴더.
// OneDrive로 동기화되지 않도록 이 컴퓨터의 로컬 폴더에 둡니다.
export const PROFILE_DIR = path.join(
  process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share'),
  'insta-notice',
  'profile',
)
