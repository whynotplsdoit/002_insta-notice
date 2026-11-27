// 지역 묶음: 주소 → 시·도, 지점들 → [시·도, [지역들]] (필터 창·매장 탭이 같이 씀)
const SIDO = ['서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종', '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주']
const SIDO_LONG = { 충청북: '충북', 충청남: '충남', 전라북: '전북', 전북특별자치: '전북', 전라남: '전남', 경상북: '경북', 경상남: '경남', 강원특별자치: '강원' }

// "서울특별시 마포구 …" / "서울 마포구 …" → "서울", "경기도 평택시" → "경기"
export function sidoOf(address) {
  const first = String(address ?? '').trim().split(/\s+/)[0]
  if (!first) return null
  for (const [long, short] of Object.entries(SIDO_LONG)) if (first.startsWith(long)) return short
  return SIDO.find((s) => first.startsWith(s)) ?? null
}

// 지역 이름 → 시·도 (주소가 없는 지점은 같은 지역 이름을 가진 다른 지점을 따름)
export function sidoOfRegionMap(branches) {
  const m = new Map()
  for (const b of branches) {
    const s = sidoOf(b.address)
    if (b.region && s && !m.has(b.region)) m.set(b.region, s)
  }
  return m
}

// 지점의 시·도
export const ONLINE = '온라인' // 오프라인 매장이 없는 매장의 지점 지역

export const branchSido = (b, regionMap) => sidoOf(b.address) ?? regionMap.get(b.region) ?? b.region ?? '기타'

// [['서울', ['홍대', '잠실']], ['부산', ['부산']], ...] (지점 많은 시·도부터, 시·도 안에서는 지점 많은 지역부터)
export function groupRegions(branches) {
  const regionMap = sidoOfRegionMap(branches)
  const groups = new Map()
  for (const b of branches) {
    if (!b.region) continue
    const sido = branchSido(b, regionMap)
    if (!groups.has(sido)) groups.set(sido, new Map())
    const m = groups.get(sido)
    m.set(b.region, (m.get(b.region) ?? 0) + 1)
  }
  return [...groups]
    .map(([sido, m]) => [sido, [...m].sort((a, b) => b[1] - a[1]).map(([r]) => r), [...m.values()].reduce((a, b) => a + b, 0)])
    // 온라인(오프라인 매장 없음)은 맨 앞에 고정 — 시·도 사이에 섞이면 안 보여서
    .sort((a, b) => (b[0] === ONLINE) - (a[0] === ONLINE) || b[2] - a[2] || a[0].localeCompare(b[0], 'ko'))
    .map(([sido, list]) => [sido, list])
}

// ---------- 매장 종류 (필터 창 · 매장 탭이 같이 씀) ----------
export const SHOP_TYPE_ORDER = ['굿즈샵', '가챠샵', '콜라보카페', '소품·기타'] // 칩 순서 (관리자 ACCOUNT_TYPES 와 같게)
export const shopTypeRank = (t) => (SHOP_TYPE_ORDER.includes(t) ? SHOP_TYPE_ORDER.indexOf(t) : SHOP_TYPE_ORDER.length)
export const shopTypeOf = (account) => account?.account_type || '굿즈샵'
