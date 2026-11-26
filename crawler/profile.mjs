import path from 'node:path'
import os from 'node:os'

// 로그인 상태(쿠키)를 저장하는 브라우저 프로필 폴더.
// OneDrive로 동기화되지 않도록 이 컴퓨터의 로컬 폴더에 둡니다.
const BASE = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share'), 'insta-notice')

// 부계정 (팔로잉 피드 읽기·매장 팔로우)
export const PROFILE_DIR = path.join(BASE, 'profile')

// 검색용 계정 (매장 신청 자동 검토·매장 찾기처럼 "보기만" 하는 일). 부계정이 막히지 않게 따로 씀
// 로그인: npm run login:search
export const SEARCH_PROFILE_DIR = path.join(BASE, 'profile-search')
