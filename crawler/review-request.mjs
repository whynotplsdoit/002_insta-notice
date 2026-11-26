// 매장 신청 자동 검토: 인스타 계정 + 네이버 플레이스를 확인해서 승인 / 거절 / 관리자 확인으로 나눔
//
// 자동 거절: 없는 계정, 비공개, 이미 등록됨, 굿즈 관련 글·소개글이 전혀 없음, 6개월 넘게 글 없음
// 자동 승인: 굿즈 관련 글이 충분 + 최근 30일 안에 글 + 네이버 플레이스에서 매장 확인 (하루 최대 AUTO_ADD_PER_DAY 곳)
// 나머지: 대기로 두고 관리자 확인 (확인한 내용은 auto_note 에 남김)
//
// 팔로우는 하지 않고 보기만 함. 승인되면 watch.mjs 의 "승인된 매장 추가" 단계가 팔로우·첫 수집을 함.
import { db } from './db.mjs'
import { inspectAccount } from './instagram.mjs'
import { findPlaces, fetchPlace, resolvePlaceId } from './naver.mjs'
import { classifyPosts } from './classify.mjs'
import { detectFixedHashtags } from './add-shop.mjs'

export const AUTO_ADD_PER_DAY = 3
const RECENT_DAYS = 30
const DEAD_DAYS = 180
const MIN_GOODS_POSTS = 3

const GOODS_WORDS = /쿠지|くじ|가챠|가차|ガチャ|피규어|굿즈|입고|애니|캐릭터|팝업|콜라보|아크릴|키링|포카|포토카드|오타쿠|덕질|원피스|산리오|치이카와|짱구|포켓몬|건담|프라모델/i
const PLACE_CATEGORY = /캐릭터|완구|장난감|취미|피규어|팬시|문구|만화|애니|게임|팝업|기념품|선물|잡화|굿즈|프라모델|토이/

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const norm = (s) => String(s ?? '').toLowerCase().replace(/[\s.·\-_()[\]'"!~|@#]/g, '').replace(/(본점|지점|점)$/, '')
const daysAgo = (iso) => Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)

// 인스타 이름 앞부분만: "오타쿠플래닛 • 홍대 피규어 & 굿즈샵" → "오타쿠플래닛"
export const cleanName = (s) => String(s ?? '').split(/\s*[•|｜/·\-–—(（[【:]\s*/)[0].trim() || null

// 주소의 시·구 (예: "서울 마포구")
const district = (address) => String(address ?? '').split(/\s+/).slice(0, 2).join(' ')

// 주소 → 지역 이름. 이미 등록된 지점 중 같은 시·구에 있는 곳이 있으면 그 지역 이름(예: 홍대)을 따름
// 없으면 서울은 구 이름, 그 밖은 시 이름. 예: "서울 마포구 …" → "마포", "부산 부산진구 …" → "부산"
export function regionFromAddress(address, known = []) {
  const d = district(address)
  const same = known.filter((b) => b.region && b.address && district(b.address) === d)
  if (d && same.length) {
    const count = new Map()
    for (const b of same) count.set(b.region, (count.get(b.region) ?? 0) + 1)
    return [...count].sort((a, b) => b[1] - a[1])[0][0]
  }
  const parts = String(address ?? '').split(/\s+/)
  if (!parts[0]) return null
  if (/^서울/.test(parts[0])) return parts[1]?.replace(/구$/, '') || '서울'
  if (/^(경기|강원|충청|충북|충남|전라|전북|전남|경상|경북|경남|제주)/.test(parts[0])) return parts[1]?.replace(/[시군]$/, '') || parts[0]
  return parts[0].replace(/(특별시|광역시|특별자치시|시)$/, '')
}

// 오늘(한국 날짜) 자동 승인한 수
// 추가 완료된 신청은 바로 지우므로 신청 표가 아니라 수집 기록(watch.mjs 의 "🔎 매장 신청 @… 자동 승인:")으로 셈
export async function autoAddedToday() {
  const start = new Date(`${new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })}T00:00:00+09:00`).toISOString()
  const { count } = await db
    .from('crawl_logs')
    .select('*', { count: 'exact', head: true })
    .like('message', '🔎 매장 신청 @% 자동 승인:%')
    .gte('created_at', start)
  return count ?? 0
}

// 네이버에서 이 매장 찾기: 인스타 주소가 연결된 플레이스 > 이름이 같고 업종이 맞는 플레이스
// mapUrl: 신청자가 보낸 지도 링크 (네이버면 그 매장을 먼저 확인)
async function findShopOnNaver(naver, username, names, region, mapUrl) {
  const isInsta = (p) => p.homepages.some((u) => new RegExp(`instagram\\.com/${username.replace(/\./g, '\\.')}(/|\\?|$)`, 'i').test(u))
  const linkId = await resolvePlaceId(naver, mapUrl)
  if (linkId) {
    try {
      const p = await fetchPlace(naver, linkId)
      return { place: p, how: isInsta(p) ? 'insta' : 'link' }
    } catch {
      // 링크 매장을 못 읽으면 이름 검색으로
    }
  }
  if (!names.length) return null
  const queries = [...new Set(names.filter(Boolean).flatMap((n) => [region ? `${n} ${region}` : null, n]).filter(Boolean))].slice(0, 3)
  const seen = new Set()
  let nameMatch = null
  for (const q of queries) {
    for (const id of await findPlaces(naver, q)) {
      if (seen.has(id) || seen.size >= 6) continue
      seen.add(id)
      let p
      try {
        p = await fetchPlace(naver, id)
      } catch {
        continue
      }
      if (isInsta(p)) {
        return { place: p, how: 'insta' }
      }
      const pn = norm(p.name)
      const same = names.some((n) => {
        const nn = norm(n)
        return nn.length >= 2 && (pn.includes(nn) || nn.includes(pn))
      })
      if (same && !nameMatch) nameMatch = { place: p, how: 'name' }
      await sleep(1000 + Math.random() * 1500)
    }
  }
  return nameMatch
}

// 반환: { decision: 'approve' | 'reject' | 'manual', note, displayName, region, naverPlaceId }
// knownBranches: 이미 등록된 지점 [{ address, region }] (지역 이름 맞추기용)
export async function reviewRequest(ig, naver, req, { registered, canAutoAdd, knownBranches = [] }) {
  const out = (decision, note, extra = {}) => ({ decision, note, ...extra })
  if (registered.has(req.username)) return out('reject', '이미 등록된 매장')

  // 1) 인스타
  const acc = await inspectAccount(ig, req.username)
  if (acc.status === 'missing') return out('reject', '없는 인스타 계정')
  if (acc.status === 'private') return out('reject', '비공개 계정 (글을 볼 수 없음)')
  // 글이 늦게 떠서 못 읽었을 수도 있으므로 거절하지 않고 관리자 확인
  if (acc.status === 'empty') return out('manual', '확인 필요 (인스타 게시물을 읽지 못함)')

  const account = { username: req.username, displayName: acc.fullName ?? req.username, accountType: '굿즈샵', fixedHashtags: detectFixedHashtags(acc.posts), branches: [] }
  const classified = classifyPosts(account, acc.posts, [])
  const goodsPosts = classified.filter((p) => p.category !== '기타' || GOODS_WORDS.test(p.caption ?? '')).length
  const bioHit = GOODS_WORDS.test(`${acc.profile?.bio ?? ''} ${acc.fullName ?? ''}`)
  const latest = acc.posts.filter((p) => !p.pinned)[0] ?? acc.posts[0]
  const days = daysAgo(latest.postedAt)
  const igNote = `굿즈 관련 글 ${goodsPosts}/${acc.posts.length}${bioHit ? ' · 소개글 굿즈 언급' : ''} · 최근 글 ${days}일 전`

  if (goodsPosts === 0 && !bioHit) return out('reject', `굿즈 관련 글·소개글 없음 (${igNote})`)
  if (days > DEAD_DAYS) return out('reject', `6개월 넘게 글 없음 (${igNote})`)

  // 2) 네이버 플레이스
  const names = [...new Set([req.display_name, cleanName(acc.fullName)].filter(Boolean))]
  const found = await findShopOnNaver(naver, req.username, names, req.region, req.map_url)
  const p = found?.place
  const catOk = p && PLACE_CATEGORY.test(`${p.category ?? ''} ${p.name}`)
  const placeOk = found && (found.how === 'insta' || catOk)
  const naverNote = p
    ? `네이버: ${p.name}${p.category ? `(${p.category})` : ''} · ${{ insta: '인스타 연결 확인', link: '신청자 지도 링크' }[found.how] ?? '이름 일치'}${p.roadAddress || p.address ? ` · ${p.roadAddress ?? p.address}` : ''}`
    : '네이버: 매장을 찾지 못함'
  const note = `${igNote} / ${naverNote}`
  const extra = {
    // 인스타 이름에 네이버 매장 이름이 들어 있으면 짧은 네이버 이름 ("홍대굿즈샵 안서당" → "안서당")
    // 신청자가 적은 이름은 검색 참고만 (신청 창에서는 칸을 뺌)
    displayName: (
      (placeOk && norm(p.name).length >= 2 && norm(cleanName(acc.fullName)).includes(norm(p.name)) ? p.name : null) ||
      cleanName(acc.fullName) ||
      p?.name ||
      req.username
    ).slice(0, 40),
    // 지역은 네이버 주소로만 정함 (신청자가 적은 "서울" 같은 값은 검색 참고만, 신청 창에서는 칸을 뺌)
    region: (regionFromAddress(p?.roadAddress ?? p?.address, knownBranches) || '').slice(0, 20) || null,
    naverPlaceId: placeOk ? p.id : null,
    // 가챠샵: 네이버 업종(오락실·뽑기)이나 이름에 가챠가 있으면
    accountType: /가챠|가차|ガチャ|gacha|뽑기|캡슐토이|오락실/i.test(`${p?.name ?? ''} ${p?.category ?? ''} ${acc.fullName ?? ''} ${req.username}`)
      ? '가챠샵'
      : '굿즈샵',
  }

  const goodsOk = goodsPosts >= MIN_GOODS_POSTS || (bioHit && goodsPosts >= 2)
  if (goodsOk && days <= RECENT_DAYS && placeOk) {
    if (!canAutoAdd) return out('manual', `오늘 자동 추가 한도(${AUTO_ADD_PER_DAY}곳) 도달 · ${note}`, extra)
    return out('approve', note, extra)
  }
  const why = [!goodsOk && '굿즈 글 적음', days > RECENT_DAYS && `최근 ${RECENT_DAYS}일 글 없음`, !placeOk && (p ? '네이버 업종 불확실' : '네이버 매장 없음')]
    .filter(Boolean)
    .join(', ')
  return out('manual', `확인 필요 (${why}) · ${note}`, extra)
}
