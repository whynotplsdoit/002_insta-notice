// 쓰레드 관리 명령
//   npm run threads:post -- "올릴 글"        글 올리기 (\n = 줄바꿈)
//   npm run threads:post -- --list [개수]     내 글 목록 + 반응
//   npm run threads:post -- --delete <글ID>   글 지우기
//   npm run threads:post -- --scopes          토큰 권한 확인
// 수정: 쓰레드 공식 API 에 글 수정 기능이 없음 → 지우고 다시 올리기
import { postText, deletePost, listPosts, postStats, tokenScopes } from './threads.mjs';

const [cmd, arg] = process.argv.slice(2);
try {
  if (cmd === '--delete') {
    await deletePost(arg);
    console.log(`🗑️ 지웠어요: ${arg}`);
  } else if (cmd === '--list') {
    const posts = await listPosts(Number(arg) || 10);
    if (!posts.length) console.log('글이 없어요.');
    for (const p of posts) {
      let stats = '';
      try {
        const s = await postStats(p.id);
        stats = ` 👀${s.views} ❤️${s.likes} 💬${s.replies} 🔁${s.reposts}`;
      } catch { /* 반응 권한 없으면 생략 */ }
      const when = new Date(p.timestamp).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
      const head = (p.text || '').split('\n')[0].slice(0, 40);
      console.log(`• ${when}${stats}\n  ${head}\n  ID ${p.id}  ${p.permalink}`);
    }
  } else if (cmd === '--scopes') {
    const scopes = await tokenScopes();
    console.log(scopes ? `🔑 토큰 권한: ${scopes.join(', ')}` : '권한 정보를 못 가져왔어요');
  } else {
    const text = process.argv.slice(2).join(' ').replace(/\\n/g, '\n');
    const { id, permalink } = await postText(text);
    console.log(`✅ 올렸어요: ${permalink}\n   글 ID ${id}`);
  }
} catch (e) {
  console.error(`❌ ${e.message}`);
  process.exitCode = 1;
}
