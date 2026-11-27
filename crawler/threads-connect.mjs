// 쓰레드(Threads) 연결 확인
// 사용: npm run threads:connect
//   1) .env 의 THREADS_ACCESS_TOKEN(대시보드에서 받은 짧은 토큰)을 60일짜리 긴 토큰으로 바꿈
//   2) 어떤 계정에 연결됐는지 확인 (아이디 출력)
//   3) 긴 토큰과 계정 번호를 .env 에 저장 (THREADS_ACCESS_TOKEN, THREADS_USER_ID, THREADS_TOKEN_EXPIRES)
// 글은 올리지 않음.
import { readFileSync, writeFileSync } from 'node:fs';

const API = 'https://graph.threads.net';
const ENV_PATH = new URL('../.env', import.meta.url);

const secret = process.env.THREADS_APP_SECRET;
let token = process.env.THREADS_ACCESS_TOKEN;

if (!secret || !token) {
  console.error('❌ .env 에 THREADS_APP_SECRET 과 THREADS_ACCESS_TOKEN 을 먼저 넣어 주세요.');
  process.exit(1);
}

async function getJson(url) {
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) {
    const msg = body.error?.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return body;
}

// 1) 짧은 토큰 → 긴 토큰 (이미 긴 토큰이면 실패하므로 그대로 사용)
let expiresAt = process.env.THREADS_TOKEN_EXPIRES || '';
try {
  const q = new URLSearchParams({ grant_type: 'th_exchange_token', client_secret: secret, access_token: token });
  const r = await getJson(`${API}/access_token?${q}`);
  token = r.access_token;
  expiresAt = new Date(Date.now() + r.expires_in * 1000).toISOString().slice(0, 10);
  console.log(`🔑 60일짜리 토큰으로 바꿨어요 (만료 ${expiresAt})`);
} catch (e) {
  console.log(`ℹ️ 토큰 교환 건너뜀 (이미 긴 토큰일 수 있음): ${e.message}`);
}

// 2) 연결된 계정 확인
let me;
try {
  me = await getJson(`${API}/v1.0/me?fields=id,username,name&access_token=${encodeURIComponent(token)}`);
} catch (e) {
  console.error(`❌ 계정 확인 실패: ${e.message}`);
  console.error('   토큰이 만료됐거나 잘못 복사됐을 수 있어요. 대시보드에서 토큰을 다시 받아 넣어 주세요.');
  process.exit(1);
}
console.log(`✅ 연결됨: @${me.username} (${me.name || ''}) / 계정 번호 ${me.id}`);

// 3) .env 저장
let env = readFileSync(ENV_PATH, 'utf8');
const setVar = (key, value) => {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  env = re.test(env) ? env.replace(re, line) : `${env.replace(/\s*$/, '')}\n${line}\n`;
};
setVar('THREADS_ACCESS_TOKEN', token);
setVar('THREADS_USER_ID', me.id);
if (expiresAt) setVar('THREADS_TOKEN_EXPIRES', expiresAt);
writeFileSync(ENV_PATH, env);
console.log('💾 .env 에 저장했어요 (THREADS_ACCESS_TOKEN, THREADS_USER_ID, THREADS_TOKEN_EXPIRES)');
