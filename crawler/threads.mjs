// 쓰레드(Threads) 글 올리기·지우기 (공식 API, .env 의 THREADS_ACCESS_TOKEN / THREADS_USER_ID 사용)
const API = 'https://graph.threads.net/v1.0';

function creds() {
  const token = process.env.THREADS_ACCESS_TOKEN;
  const userId = process.env.THREADS_USER_ID;
  if (!token || !userId) throw new Error('THREADS_ACCESS_TOKEN / THREADS_USER_ID 가 없어요 (npm run threads:connect 먼저)');
  return { token, userId };
}

async function call(method, path, params = {}) {
  const { token } = creds();
  const q = new URLSearchParams({ ...params, access_token: token });
  const res = await fetch(`${API}${path}?${q}`, { method });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) throw new Error(body.error?.message || `HTTP ${res.status}`);
  return body;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 글자만 있는 글 올리기 → { id, permalink }
export async function postText(text) {
  if (!text || text.length > 500) throw new Error('글은 1~500자여야 해요');
  const { userId } = creds();
  const { id: creationId } = await call('POST', `/${userId}/threads`, { media_type: 'TEXT', text });
  // 컨테이너 준비 확인 (글자 글은 보통 바로 끝남)
  for (let i = 0; i < 10; i++) {
    const s = await call('GET', `/${creationId}`, { fields: 'status,error_message' });
    if (s.status === 'FINISHED') break;
    if (s.status === 'ERROR' || s.status === 'EXPIRED') throw new Error(`준비 실패: ${s.error_message || s.status}`);
    await sleep(3000);
  }
  const { id } = await call('POST', `/${userId}/threads_publish`, { creation_id: creationId });
  const { permalink } = await call('GET', `/${id}`, { fields: 'permalink' });
  return { id, permalink };
}

export async function deletePost(id) {
  return call('DELETE', `/${id}`);
}

// 내 글 목록 (최신순)
export async function listPosts(limit = 10) {
  const { userId } = creds();
  const { data } = await call('GET', `/${userId}/threads`, {
    fields: 'id,text,timestamp,permalink,media_type', limit: String(limit),
  });
  return data || [];
}

// 글 하나의 반응 (조회수·좋아요·답글·리포스트·인용)
export async function postStats(id) {
  const { data } = await call('GET', `/${id}/insights`, { metric: 'views,likes,replies,reposts,quotes' });
  return Object.fromEntries((data || []).map((m) => [m.name, m.values?.[0]?.value ?? m.total_value?.value ?? 0]));
}

// 연결된 토큰에 실제로 들어 있는 권한 확인
export async function tokenScopes() {
  const { token } = creds();
  const q = new URLSearchParams({ input_token: token, access_token: token });
  const res = await fetch(`https://graph.threads.net/v1.0/debug_token?${q}`);
  const body = await res.json().catch(() => ({}));
  return body.data?.scopes || null;
}
