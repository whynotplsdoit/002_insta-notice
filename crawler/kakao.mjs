// 카카오톡 "나에게 보내기" 알림
// - 처음 한 번: npm run kakao:login → 브라우저에서 카카오 로그인·허락 → 토큰 저장
// - 토큰은 OneDrive 밖(%LOCALAPPDATA%\insta-notice\kakao-token.json)에 저장 (GitHub·클라우드에 올라가지 않음)
// - 접근 토큰은 몇 시간마다 만료되지만 저장된 갱신 토큰으로 자동 연장. 갱신 토큰은 약 2달 유효하고 쓰는 동안 자동 연장됨
import fs from 'node:fs/promises'
import path from 'node:path'
import { PROFILE_DIR } from './profile.mjs'

export const REDIRECT_URI = 'http://localhost:5179/kakao'
const TOKEN_FILE = path.join(path.dirname(PROFILE_DIR), 'kakao-token.json')
const SITE_URL = 'https://goods-radar-xi.vercel.app'

const clientId = () => {
  const key = process.env.KAKAO_REST_API_KEY
  if (!key) throw new Error('.env 에 KAKAO_REST_API_KEY 를 넣어주세요.')
  return key
}
const withSecret = (params) => {
  if (process.env.KAKAO_CLIENT_SECRET) params.client_secret = process.env.KAKAO_CLIENT_SECRET
  return params
}

export function authorizeUrl() {
  const q = new URLSearchParams({ client_id: clientId(), redirect_uri: REDIRECT_URI, response_type: 'code', scope: 'talk_message' })
  return `https://kauth.kakao.com/oauth/authorize?${q}`
}

async function tokenRequest(params) {
  const res = await fetch('https://kauth.kakao.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body: new URLSearchParams(withSecret({ client_id: clientId(), ...params })),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(`카카오 토큰 오류: ${json.error_description ?? json.error ?? res.status}`)
  return json
}

async function saveToken(t, prev = {}) {
  const now = Date.now()
  const data = {
    access_token: t.access_token,
    access_expires_at: now + (t.expires_in ?? 0) * 1000,
    // 갱신할 때 새 갱신 토큰은 만료가 가까울 때만 내려옴 → 없으면 이전 것 유지
    refresh_token: t.refresh_token ?? prev.refresh_token,
    refresh_expires_at: t.refresh_token_expires_in ? now + t.refresh_token_expires_in * 1000 : prev.refresh_expires_at,
  }
  await fs.mkdir(path.dirname(TOKEN_FILE), { recursive: true })
  await fs.writeFile(TOKEN_FILE, JSON.stringify(data, null, 2), 'utf8')
  return data
}

async function loadToken() {
  try {
    return JSON.parse(await fs.readFile(TOKEN_FILE, 'utf8'))
  } catch {
    return null
  }
}

// 로그인 후 받은 코드로 토큰 발급
export async function exchangeCode(code) {
  return saveToken(await tokenRequest({ grant_type: 'authorization_code', redirect_uri: REDIRECT_URI, code }))
}

// 유효한 접근 토큰 (만료 10분 전이면 갱신)
async function accessToken() {
  const t = await loadToken()
  if (!t?.refresh_token) throw new Error('카카오 로그인이 필요합니다. npm run kakao:login 을 실행하세요.')
  if (t.access_token && t.access_expires_at - Date.now() > 10 * 60_000) return t.access_token
  const fresh = await saveToken(await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh_token }), t)
  return fresh.access_token
}

// 갱신 토큰 남은 일수 (null = 로그인 안 됨)
export async function kakaoDaysLeft() {
  const t = await loadToken()
  if (!t?.refresh_expires_at) return null
  return Math.floor((t.refresh_expires_at - Date.now()) / 86400000)
}

export const kakaoConfigured = () => Boolean(process.env.KAKAO_REST_API_KEY)

// 카톡 "나와의 채팅"으로 보내기. 모든 알림 맨 앞에 [굿즈레이더] 를 붙임
// url 을 주면 [굿즈레이더 열기] 버튼이 그 주소로 연결
const PREFIX = '[굿즈레이더] '
export async function sendKakao(text, url = SITE_URL) {
  const body = text.startsWith(PREFIX) ? text : PREFIX + text
  const template = {
    object_type: 'text',
    text: body.slice(0, 200), // 카카오 텍스트 템플릿 최대 200자
    link: { web_url: url, mobile_web_url: url },
    button_title: '굿즈레이더 열기',
  }
  const res = await fetch('https://kapi.kakao.com/v2/api/talk/memo/default/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
    },
    body: new URLSearchParams({ template_object: JSON.stringify(template) }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json.result_code !== 0) throw new Error(`카톡 보내기 실패: ${json.msg ?? res.status}`)
}
