import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // 상위 폴더의 .env 를 읽되, 화면에 넣어도 되는 두 값만 허용 (비밀 키는 절대 포함되지 않음)
  envDir: '..',
  envPrefix: ['VITE_', 'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY'],
  build: {
    // 지원 브라우저: Chrome/Edge 최근 2개, Safari·iOS 16 이상, 삼성 인터넷, Firefox
    target: ['chrome109', 'edge109', 'safari16', 'ios16', 'firefox115'],
  },
})
