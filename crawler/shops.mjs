// 매장 추가 신청 관리 (명령으로 처리할 때. 보통은 관리자 화면 /admin 에서 처리)
//
// 사용법
//   npm run shops                                   대기 중인 신청 목록
//   npm run shops -- approve <아이디>               바로 추가: 팔로우 → 첫 수집 → 목록에 추가
//        옵션: --name 매장이름  --region 지역  --type 콜라보카페  --interval 6
//   npm run shops -- reject <아이디>                거절
import { db } from './db.mjs'
import { openBrowser } from './instagram.mjs'
import { loadConfig } from './store.mjs'
import { addShop } from './add-shop.mjs'

const [command, target, ...rest] = process.argv.slice(2)
const option = (name) => {
  const i = rest.indexOf(`--${name}`)
  return i >= 0 ? rest[i + 1] : undefined
}
const fmt = (iso) => new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })

async function openRequest(username) {
  const { data, error } = await db
    .from('shop_requests')
    .select('*')
    .eq('username', username)
    .in('status', ['pending', 'approved'])
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

async function finish(id, status, result) {
  const { error } = await db
    .from('shop_requests')
    .update({ status, result, reviewed_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

if (!command) {
  const { data, error } = await db
    .from('shop_requests')
    .select('*')
    .in('status', ['pending', 'approved'])
    .order('created_at')
  if (error) throw new Error(error.message)
  if (data.length === 0) console.log('처리할 매장 신청이 없습니다.')
  for (const r of data) {
    console.log(`[${r.status === 'approved' ? '승인됨·처리 대기' : '대기'}] @${r.username}  https://www.instagram.com/${r.username}/`)
    console.log(`  이름: ${r.display_name ?? '-'} | 지역: ${r.region ?? '-'} | 신청: ${fmt(r.created_at)}`)
    if (r.note) console.log(`  메모: ${r.note}`)
  }
} else if (command === 'reject') {
  const request = await openRequest(target)
  if (!request) throw new Error(`@${target} 의 처리할 신청이 없습니다.`)
  await finish(request.id, 'rejected', '거절')
  console.log(`@${target} 신청을 거절했습니다.`)
} else if (command === 'approve') {
  const username = (target ?? '').toLowerCase()
  if (!/^[a-z0-9._]{1,30}$/.test(username)) throw new Error('사용법: npm run shops -- approve <인스타 아이디>')
  const config = await loadConfig()
  if (config.accounts.some((a) => a.username === username)) throw new Error(`@${username} 는 이미 등록된 매장입니다.`)
  const request = await openRequest(username)

  const context = await openBrowser()
  try {
    const r = await addShop(
      context,
      {
        username,
        displayName: option('name') ?? request?.display_name,
        region: option('region') ?? request?.region,
        accountType: option('type') ?? request?.account_type,
        intervalHours: option('interval') ? Number(option('interval')) : undefined,
      },
      config.works,
    )
    const msg = `${r.account.displayName} 추가 완료: 글 ${r.total}개, 사진 ${r.imagesUploaded}장${r.followed === 'failed' ? ' (⚠ 팔로우 실패: 부계정으로 직접 팔로우 필요)' : ''}`
    if (request) await finish(request.id, 'done', msg)
    console.log(`✓ ${msg}`)
  } catch (err) {
    if (request) await finish(request.id, 'failed', err.message)
    throw err
  } finally {
    await context.close()
  }
} else {
  console.log('알 수 없는 명령입니다. npm run shops / approve <아이디> / reject <아이디>')
}
