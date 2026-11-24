// 네이버 지도(플레이스)에서 매장 정보 읽기
// - findPlaces: 검색어로 플레이스 후보 찾기
// - fetchPlace: 플레이스 번호로 주소·전화·영업시간·휴무 읽기
import { chromium } from 'playwright'

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

export async function openNaverBrowser() {
  const browser = await chromium.launch()
  const context = await browser.newContext({ locale: 'ko-KR', viewport: { width: 420, height: 900 }, userAgent: MOBILE_UA })
  return { browser, context }
}

// 네이버 플레이스 주소에서 번호 뽑기: map.naver.com/p/entry/place/123, m.place.naver.com/place/123, naver.me 는 열어서 확인
export function placeIdFromUrl(url) {
  return String(url ?? '').match(/place\/(\d{5,})/)?.[1] ?? (/^\d{5,}$/.test(String(url ?? '').trim()) ? String(url).trim() : null)
}

export async function findPlaces(context, query) {
  const page = await context.newPage()
  try {
    await page.goto('https://m.search.naver.com/search.naver?query=' + encodeURIComponent(query), { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2000)
    const ids = await page.evaluate(() =>
      [...document.querySelectorAll('a[href*="/place/"]')].map((a) => a.href.match(/place\/(\d{5,})/)?.[1]).filter(Boolean),
    )
    return [...new Set(ids)].slice(0, 5)
  } finally {
    await page.close()
  }
}

const WEEK = ['월', '화', '수', '목', '금', '토', '일']
// '매일' → 월~일, '평일' → 월~금, '주말' → 토·일, '월~금' → 월·화·수·목·금, '월,수' → 월·수
export function expandDays(label) {
  const t = String(label ?? '').replace(/\s/g, '')
  if (!t) return []
  if (t.includes('매일')) return [...WEEK]
  if (t.includes('평일')) return WEEK.slice(0, 5)
  if (t.includes('주말')) return WEEK.slice(5)
  const range = t.match(/^([월화수목금토일])[~\-–]([월화수목금토일])$/)
  if (range) {
    const a = WEEK.indexOf(range[1])
    const b = WEEK.indexOf(range[2])
    return a <= b ? WEEK.slice(a, b + 1) : [...WEEK.slice(a), ...WEEK.slice(0, b + 1)]
  }
  const days = [...t].filter((c) => WEEK.includes(c))
  return days.length ? days : [t]
}

// 반환: { id, name, category, roadAddress, address, phone, directions, homepages[], hours[{day,start,end,breaks,note}], closedRegular, closedComing[], hoursNote }
export async function fetchPlace(context, id) {
  const page = await context.newPage()
  try {
    await page.goto(`https://m.place.naver.com/place/${id}/home`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2500)
    const state = await page.evaluate(() => window.__APOLLO_STATE__ ?? null)
    if (!state) throw new Error('네이버 플레이스 정보를 읽지 못했습니다.')
    const base = state[`PlaceDetailBase:${id}`] ?? Object.values(state).find((v) => v?.__typename === 'PlaceDetailBase')
    if (!base) throw new Error('네이버 플레이스 기본 정보가 없습니다.')

    // 영업시간·홈페이지는 ROOT_QUERY 안쪽 어딘가에 있어서 전체를 뒤져 찾음
    let hoursBlock = null
    const homepages = new Set()
    const walk = (v) => {
      if (!v || typeof v !== 'object') return
      if (Array.isArray(v)) return v.forEach(walk)
      if (!hoursBlock && Array.isArray(v.newBusinessHours) && v.newBusinessHours.length) hoursBlock = v.newBusinessHours[0]
      if (typeof v.url === 'string' && /instagram\.com|^https?:/.test(v.url) && v.type) homepages.add(v.url)
      Object.values(v).forEach(walk)
    }
    walk(state)

    // "매일", "평일", "월~금" 같은 묶음 표기는 요일별로 풀어서 저장
    const hours = (hoursBlock?.businessHours ?? []).flatMap((h) =>
      expandDays(h.day).map((day) => ({
        day,
        start: h.businessHours?.start ?? null,
        end: h.businessHours?.end ?? null,
        breaks: (h.breakHours ?? []).map((b) => `${b.start}-${b.end}`),
        note: h.description ?? null,
      })),
    )
    return {
      id,
      name: base.name,
      category: base.category ?? null,
      roadAddress: base.roadAddress ?? null,
      address: base.address ?? null,
      phone: base.phone ?? base.virtualPhone ?? null,
      directions: base.road ?? null,
      homepages: [...homepages],
      hours,
      closedRegular: hoursBlock?.comingRegularClosedDays || null,
      closedComing: (hoursBlock?.comingIrregularClosedDays ?? []).map((d) => (typeof d === 'string' ? d : JSON.stringify(d))),
      hoursNote: hoursBlock?.freeText || null,
    }
  } finally {
    await page.close()
  }
}
