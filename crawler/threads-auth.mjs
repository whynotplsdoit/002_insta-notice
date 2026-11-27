// 쓰레드 권한 전체(삭제 포함) 토큰 받기 — 토큰 생성기는 threads_delete 를 안 넣어 줘서 로그인 승인 방식 사용
//   1) npm run threads:auth            → 승인 주소 출력 (브라우저에서 열어 허용)
//   2) npm run threads:auth -- "<허용 후 이동된 주소 전체 또는 code>"  → 60일 토큰을 .env 에 저장
import { readFileSync, writeFileSync } from 'node:fs';

const APP_ID = '987139610717992';
const REDIRECT = 'https://goods-radar-xi.vercel.app/';
const SCOPES = [
  'threads_basic', 'threads_content_publish', 'threads_delete',
  'threads_manage_insights', 'threads_manage_replies', 'threads_read_replies',
];
const ENV_PATH = new URL('../.env', import.meta.url);

const input = process.argv[2];
if (!input) {
  const q = new URLSearchParams({ client_id: APP_ID, redirect_uri: REDIRECT, scope: SCOPES.join(','), response_type: 'code' });
  console.log(`https://threads.net/oauth/authorize?${q}`);
} else {
  try {
    let code = input.includes('code=') ? new URL(input).searchParams.get('code') : input;
    code = code.replace(/#_$/, '');
    const secret = process.env.THREADS_APP_SECRET;

    const res = await fetch('https://graph.threads.net/oauth/access_token', {
      method: 'POST',
      body: new URLSearchParams({ client_id: APP_ID, client_secret: secret, grant_type: 'authorization_code', redirect_uri: REDIRECT, code }),
    });
    const short = await res.json();
    if (short.error || !short.access_token) throw new Error(short.error?.message || short.error_message || JSON.stringify(short));

    const q = new URLSearchParams({ grant_type: 'th_exchange_token', client_secret: secret, access_token: short.access_token });
    const long = await (await fetch(`https://graph.threads.net/access_token?${q}`)).json();
    if (long.error || !long.access_token) throw new Error(long.error?.message || JSON.stringify(long));

    // user_id 는 숫자가 커서 JSON 숫자로 읽으면 끝자리가 틀어짐 → /me 에서 문자열로 받기
    const me = await (await fetch(`https://graph.threads.net/v1.0/me?fields=id&access_token=${encodeURIComponent(long.access_token)}`)).json();
    if (!me.id) throw new Error(me.error?.message || '계정 번호 확인 실패');

    const expires = new Date(Date.now() + long.expires_in * 1000).toISOString().slice(0, 10);
    let env = readFileSync(ENV_PATH, 'utf8');
    const setVar = (k, v) => {
      const re = new RegExp(`^${k}=.*$`, 'm');
      env = re.test(env) ? env.replace(re, `${k}=${v}`) : `${env.replace(/\s*$/, '')}\n${k}=${v}\n`;
    };
    setVar('THREADS_ACCESS_TOKEN', long.access_token);
    setVar('THREADS_USER_ID', me.id);
    setVar('THREADS_TOKEN_EXPIRES', expires);
    writeFileSync(ENV_PATH, env);
    console.log(`✅ 새 토큰 저장 (만료 ${expires})`);
  } catch (e) {
    console.error(`❌ ${e.message}`);
    process.exitCode = 1;
  }
}
