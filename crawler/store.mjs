// 수집한 게시물을 분류해서 Supabase에 저장합니다.
// 매장 목록의 원본은 DB입니다 (관리자 화면에서 수정). config/*.json 은 처음 한 번 넣을 때만 씁니다.
import fs from 'node:fs/promises'
import { db } from './db.mjs'
import { classifyPosts } from './classify.mjs'
import { hasNoCaption, loadDeletedCodes, recordDeleted } from './cleanup.mjs'
import { CACHE_SECONDS, POST_WIDTH, PROFILE_WIDTH, THUMB_WIDTH, shrinkImage, thumbPath } from './shrink.mjs'

const BUCKET = 'post-images'

const check = (label, { error }) => {
  if (error) throw new Error(`${label}: ${error.message}`)
}

// DB에서 매장·지점·작품 사전 읽기 (classify.mjs 가 쓰는 모양으로)
export async function loadConfig() {
  const [a, b, w] = await Promise.all([
    db.from('accounts').select('*'),
    db.from('branches').select('*').order('id'),
    db.from('works').select('*'),
  ])
  check('매장 읽기', a)
  check('지점 읽기', b)
  check('작품 사전 읽기', w)
  const accounts = a.data.map((r) => ({
    username: r.username,
    displayName: r.display_name,
    accountType: r.account_type,
    fixedHashtags: r.fixed_hashtags ?? [],
    crawlIntervalHours: r.crawl_interval_hours,
    hidden: r.hidden,
    lastCrawledAt: r.last_crawled_at,
    branches: b.data
      .filter((x) => x.account_username === r.username)
      .map((x) => ({ name: x.name, aliases: x.aliases ?? [], region: x.region, address: x.address })),
  }))
  return { accounts, works: w.data.map((x) => ({ name: x.name, aliases: x.aliases })) }
}

// 매장 하나를 DB에 넣기 (매장 추가 승인할 때)
export async function addAccount(account) {
  check(
    '매장 저장',
    await db.from('accounts').upsert({
      username: account.username,
      display_name: account.displayName,
      account_type: account.accountType,
      crawl_interval_hours: account.crawlIntervalHours,
      fixed_hashtags: account.fixedHashtags,
      hidden: false,
    }),
  )
  check(
    '지점 저장',
    await db.from('branches').upsert(
      account.branches.map((br) => ({
        account_username: account.username,
        name: br.name,
        region: br.region,
        address: br.address,
        aliases: br.aliases ?? [],
      })),
      { onConflict: 'account_username,name' },
    ),
  )
}

// config/*.json 을 DB에 넣기 (처음 한 번: npm run seed)
export async function pushConfigFiles() {
  const accounts = JSON.parse(await fs.readFile('config/accounts.json', 'utf8'))
  const works = JSON.parse(await fs.readFile('config/works.json', 'utf8'))
  for (const a of accounts) await addAccount(a)
  check('작품 사전 저장', await db.from('works').upsert(works.map((w) => ({ name: w.name, aliases: w.aliases }))))
  return { accounts, works }
}

// 인스타 사진을 받아서 작게 줄인 뒤(webp) 우리 저장소에 올림. 실패하면 null (다음 수집 때 다시 시도)
async function uploadImage(username, code, imageUrl, width = POST_WIDTH) {
  if (!imageUrl) return null
  try {
    const res = await fetch(imageUrl)
    if (!res.ok) return null
    const type = res.headers.get('content-type') ?? 'image/jpeg'
    if (!type.startsWith('image/')) return null
    const original = Buffer.from(await res.arrayBuffer())
    const path = `${username}/${code}.webp`
    const put = async (p, buf) =>
      (await db.storage.from(BUCKET).upload(p, buf, { contentType: 'image/webp', upsert: true, cacheControl: CACHE_SECONDS })).error
    // 글 사진은 목록용 작은 사진도 같이 (사이트는 작은 사진이 없으면 큰 사진을 씀)
    if (width === POST_WIDTH) await put(thumbPath(path), await shrinkImage(original, THUMB_WIDTH))
    const error = await put(path, await shrinkImage(original, width))
    return error ? null : path
  } catch {
    return null
  }
}

// 다시 저장할지 비교하는 칸. 바뀐 게 없으면 저장하지 않음
// (저장할 때마다 사이트를 보고 있는 모든 사람에게 실시간 알림이 가서 Supabase 전송량을 씀)
const COMPARE = ['url', 'posted_at', 'media_type', 'pinned', 'caption', 'image_path', 'category', 'goods_type', 'works', 'branches', 'starts_at', 'ends_at']
const TIME_COLS = new Set(['posted_at', 'starts_at', 'ends_at'])
const sameValue = (col, a, b) => {
  if (a == null || b == null) return a == null && b == null
  if (TIME_COLS.has(col)) return new Date(a).getTime() === new Date(b).getTime()
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a) === JSON.stringify(b)
  return a === b
}
const changed = (row, old) => Object.keys(row).some((k) => COMPARE.includes(k) && !sameValue(k, row[k], old[k]))

const codeOf = (post) => post.code ?? post.url.match(/\/(?:p|reel)\/([^/]+)/)?.[1]

// 한 매장의 게시물 저장. 반환: { total, added, imagesUploaded }
// 관리자가 분류를 직접 고친 글(manual)은 분류 칸을 덮어쓰지 않습니다.
export async function savePosts(account, posts, works) {
  const withCode = posts.map((p) => ({ ...p, code: codeOf(p) })).filter((p) => p.code)
  // 본문이 없는 글은 수집하지 않고, 다시 확인하지 않도록 기록만 해 둠
  const deleted = await loadDeletedCodes()
  const empty = withCode.filter((p) => hasNoCaption(p) && !deleted.has(p.code))
  await recordDeleted(empty.map((p) => ({ code: p.code, account_username: account.username })))
  for (const p of empty) deleted.add(p.code)
  // 분류(반복 문구 찾기)는 최근 글 전체로 하고, 저장은 지운 글·본문 없는 글을 빼고 함
  let classified = classifyPosts(account, withCode, works).filter((p) => !deleted.has(p.code))

  const { data: existing, error } = await db
    .from('posts')
    .select(`code, manual, ${COMPARE.join(', ')}`)
    .in('code', classified.map((p) => p.code))
  if (error) throw new Error(`기존 글 확인: ${error.message}`)
  const known = new Map(existing.map((e) => [e.code, e]))

  // '기타' 새 글 중 본문이 사실상 없는 글(해시태그·이모지뿐)은 저장하지 않고 지운 글로 기록
  const noBody = classified.filter((p) => p.emptyBody && !known.has(p.code))
  await recordDeleted(noBody.map((p) => ({ code: p.code, account_username: account.username })))
  classified = classified.filter((p) => !noBody.includes(p))

  let imagesUploaded = 0
  const newRows = [] // 처음 들어오는 글
  const autoRows = [] // 이미 있는 글 (자동 분류로 갱신)
  const manualRows = [] // 관리자가 고친 글 (분류는 그대로)
  for (const p of classified) {
    let imagePath = known.get(p.code)?.image_path ?? null
    if (!imagePath) {
      imagePath = await uploadImage(account.username, p.code, p.imageUrl)
      if (imagePath) imagesUploaded++
    }
    const base = {
      code: p.code,
      account_username: account.username,
      url: p.url,
      posted_at: p.postedAt,
      media_type: p.type,
      pinned: p.pinned,
      caption: p.caption,
      image_path: imagePath,
      updated_at: new Date().toISOString(),
      // first_seen_at, hidden 은 처음 넣을 때만 DB가 기본값으로 채움
    }
    const auto = {
      ...base,
      category: p.category,
      goods_type: p.goodsType,
      works: p.works,
      branches: p.branches,
      starts_at: p.startsAt,
      ends_at: p.endsAt,
    }
    if (!known.has(p.code)) {
      // '기타' 새 글: 굿즈 홍보면 그대로 게시, 아니면 사이트("전체" 탭)에 보이면서 관리자 검토 대기
      const review = p.category === '기타' && !p.goodsPromo
      newRows.push({ ...auto, hidden: false, needs_review: review })
    } else if (known.get(p.code).manual) {
      if (changed(base, known.get(p.code))) manualRows.push(base)
    } else if (changed(auto, known.get(p.code))) {
      autoRows.push(auto)
    }
  }

  if (newRows.length) check('게시물 저장', await db.from('posts').upsert(newRows))
  if (autoRows.length) check('게시물 저장', await db.from('posts').upsert(autoRows))
  if (manualRows.length) check('게시물 저장', await db.from('posts').upsert(manualRows))
  return {
    total: classified.length,
    added: newRows.length,
    updated: autoRows.length + manualRows.length,
    imagesUploaded,
  }
}

// 인스타 프로필(이름·소개글·링크·사진) 저장. 사진은 일주일에 한 번만 다시 올림
const PROFILE_IMAGE_DAYS = 7
export async function saveProfile(username, profile) {
  if (!profile) return
  const { data: cur } = await db
    .from('accounts')
    .select('profile_image_path, profile_updated_at')
    .eq('username', username)
    .maybeSingle()
  const row = { ig_full_name: profile.fullName, bio: profile.bio, external_url: profile.externalUrl }
  const stale =
    !cur?.profile_image_path ||
    !cur.profile_updated_at ||
    Date.now() - new Date(cur.profile_updated_at).getTime() > PROFILE_IMAGE_DAYS * 86400000
  if (stale && profile.profilePicUrl) {
    const path = await uploadImage('_profiles', username, profile.profilePicUrl, PROFILE_WIDTH)
    if (path) {
      row.profile_image_path = path
      row.profile_updated_at = new Date().toISOString()
    }
  }
  check('프로필 저장', await db.from('accounts').update(row).eq('username', username))
}

export async function markCrawled(username) {
  check(
    '수집 시각 저장',
    await db.from('accounts').update({ last_crawled_at: new Date().toISOString() }).eq('username', username),
  )
}
