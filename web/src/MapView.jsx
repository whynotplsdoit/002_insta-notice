// 지도 보기 (카카오맵)
// - 매장 지점마다 핀: 색으로 영업 상태 (영업 중 초록 / 영업 전 파랑 / 종료·휴무 빨강 / 정보 없음 회색)
// - 핀을 누르면 아래에 지점 카드 → [매장 정보] [네이버 지도로 길찾기]
// - [내 위치]: 누를 때만 휴대폰 위치를 물어보고 지도에만 표시 (저장·전송하지 않음)
// - 처음에는 매장이 가장 많은 지역(홍대)을 보여주고, [전체 보기]로 모든 지점
import { useEffect, useMemo, useRef, useState } from 'react'
import { openStatus } from './hours.js'

const JS_KEY = import.meta.env.VITE_KAKAO_JS_KEY
const FAR_LEVEL = 5 // 이 레벨부터(더 넓게) 이름표 숨김

// 카카오맵 스크립트는 한 번만 불러옴
let sdkPromise = null
function loadKakao() {
  if (window.kakao?.maps?.LatLng) return Promise.resolve(window.kakao)
  if (!sdkPromise) {
    sdkPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${JS_KEY}&autoload=false`
      s.onload = () => window.kakao.maps.load(() => resolve(window.kakao))
      s.onerror = () => {
        sdkPromise = null
        reject(new Error('카카오맵을 불러오지 못했습니다.'))
      }
      document.head.appendChild(s)
    })
  }
  return sdkPromise
}

// 두 좌표 사이 거리 (m)
function distance(a, b) {
  const R = 6371000
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
const fmtDistance = (m) => (m < 1000 ? `${Math.round(m / 10) * 10}m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)}km`)

export default function MapView({ branches, shopOf, postCountOf, now, onShopOpen }) {
  const boxRef = useRef(null)
  const mapRef = useRef(null)
  const overlaysRef = useRef([])
  const meRef = useRef(null)
  const [error, setError] = useState(JS_KEY ? '' : 'nokey')
  const [selected, setSelected] = useState(null) // 지점 id
  const [me, setMe] = useState(null) // { lat, lng } 내 위치 (저장하지 않음)
  const [locating, setLocating] = useState(false)
  const [far, setFar] = useState(false) // 지도를 넓게 보는 중이면 이름표 숨김

  // 지도에 올릴 지점 (좌표가 있는 것만)
  const pins = useMemo(
    () =>
      branches
        .filter((b) => b.lat && b.lng && shopOf.has(b.account_username))
        .map((b) => ({ ...b, shop: shopOf.get(b.account_username), status: openStatus(b.hours, now) })),
    [branches, shopOf, now],
  )
  const missing = branches.filter((b) => shopOf.has(b.account_username) && !(b.lat && b.lng)).length

  // 지도 만들기
  useEffect(() => {
    if (!JS_KEY) return
    let cancelled = false
    loadKakao()
      .then((kakao) => {
        if (cancelled || !boxRef.current) return
        mapRef.current = new kakao.maps.Map(boxRef.current, { center: new kakao.maps.LatLng(37.5563, 126.9236), level: 5 })
        mapRef.current.addControl(new kakao.maps.ZoomControl(), kakao.maps.ControlPosition.RIGHT)
        kakao.maps.event.addListener(mapRef.current, 'click', () => setSelected(null))
        // 넓게 볼 때는 이름표를 숨기고 점만 (겹침 방지)
        kakao.maps.event.addListener(mapRef.current, 'zoom_changed', () => setFar(mapRef.current.getLevel() >= FAR_LEVEL))
        setError('')
        drawPins()
        fitTo('main')
        setFar(mapRef.current.getLevel() >= FAR_LEVEL)
      })
      .catch(() => setError('load'))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 핀 다시 그리기 (필터·영업 상태가 바뀌면)
  useEffect(() => {
    drawPins()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pins, selected])

  function drawPins() {
    const kakao = window.kakao
    const map = mapRef.current
    if (!kakao?.maps || !map) return
    overlaysRef.current.forEach((o) => o.setMap(null))
    overlaysRef.current = pins.map((b) => {
      const el = document.createElement('button')
      el.type = 'button'
      el.className = `map-pin ${b.status.kind}${selected === b.id ? ' on' : ''}`
      el.innerHTML = `<span class="map-pin-dot"></span><span class="map-pin-name"></span>`
      el.querySelector('.map-pin-name').textContent =
        b.shop.display_name + (branches.filter((x) => x.account_username === b.account_username).length > 1 ? ` ${b.name}` : '')
      el.addEventListener('click', (e) => {
        e.stopPropagation()
        setSelected(b.id)
        map.panTo(new kakao.maps.LatLng(b.lat, b.lng))
      })
      const o = new kakao.maps.CustomOverlay({ position: new kakao.maps.LatLng(b.lat, b.lng), content: el, yAnchor: 1, zIndex: selected === b.id ? 3 : 1 })
      o.setMap(map)
      return o
    })
  }

  // 화면 맞추기: 'main' = 지점이 가장 많은 지역, 'all' = 전체
  function fitTo(what) {
    const kakao = window.kakao
    const map = mapRef.current
    if (!kakao?.maps || !map || pins.length === 0) return
    let list = pins
    if (what === 'main') {
      const count = new Map()
      for (const p of pins) count.set(p.region, (count.get(p.region) ?? 0) + 1)
      const top = [...count].sort((a, b) => b[1] - a[1])[0]?.[0]
      list = pins.filter((p) => p.region === top)
    }
    const bounds = new kakao.maps.LatLngBounds()
    list.forEach((p) => bounds.extend(new kakao.maps.LatLng(p.lat, p.lng)))
    if (list.length === 1) map.setCenter(new kakao.maps.LatLng(list[0].lat, list[0].lng))
    else map.setBounds(bounds, 60, 40, 60, 40)
  }

  // 내 위치 (누를 때만, 저장·전송하지 않음)
  function locate() {
    if (!navigator.geolocation) return alert('이 브라우저에서는 위치를 확인할 수 없습니다.')
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false)
        const here = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        setMe(here)
        const kakao = window.kakao
        if (!kakao?.maps || !mapRef.current) return
        meRef.current?.setMap(null)
        const dot = document.createElement('div')
        dot.className = 'map-me'
        meRef.current = new kakao.maps.CustomOverlay({ position: new kakao.maps.LatLng(here.lat, here.lng), content: dot, zIndex: 4 })
        meRef.current.setMap(mapRef.current)
        mapRef.current.setLevel(4)
        mapRef.current.panTo(new kakao.maps.LatLng(here.lat, here.lng))
      },
      (err) => {
        setLocating(false)
        alert(err.code === 1 ? '위치 사용을 허용하지 않아 내 위치를 표시할 수 없습니다.' : '내 위치를 찾지 못했습니다. 잠시 후 다시 시도해 주세요.')
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    )
  }

  // 내 위치가 있으면 가까운 순으로 지점 목록
  const nearby = useMemo(
    () => (me ? pins.map((p) => ({ ...p, dist: distance(me, p) })).sort((a, b) => a.dist - b.dist).slice(0, 5) : []),
    [me, pins],
  )
  const sel = pins.find((p) => p.id === selected)

  if (error === 'nokey') {
    return <div className="state">지도 키가 없습니다. .env 의 VITE_KAKAO_JS_KEY 를 확인하세요.</div>
  }

  return (
    <div className={`map-wrap${far ? ' far' : ''}`}>
      <div ref={boxRef} className="map-box" />
      {error === 'load' && (
        <div className="map-error">
          지도를 불러오지 못했습니다.
          <br />
          카카오 개발자 사이트에 이 사이트 주소가 등록돼 있는지, 카카오맵 사용이 켜져 있는지 확인해 주세요.
        </div>
      )}

      <div className="map-tools">
        <button type="button" className="map-tool" onClick={locate} disabled={locating}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
          </svg>
          {locating ? '찾는 중…' : '내 위치'}
        </button>
        <button type="button" className="map-tool" onClick={() => fitTo('all')}>
          전체 보기
        </button>
      </div>

      <div className="map-legend" aria-hidden="true">
        <span><i className="open" />영업 중</span>
        <span><i className="before" />영업 전</span>
        <span><i className="closed" />종료·휴무</span>
      </div>

      {sel && (
        <div className="map-card">
          <div className="map-card-head">
            <b>
              {sel.shop.display_name}
              {branches.filter((x) => x.account_username === sel.account_username).length > 1 && <span> · {sel.name}</span>}
            </b>
            <span className={`open-status ${sel.status.kind}`}>{sel.status.text}</span>
          </div>
          {sel.address && <p className="map-card-addr">{sel.address}</p>}
          <p className="map-card-meta">
            최근 소식 {postCountOf.get(sel.account_username) ?? 0}개{me ? ` · 내 위치에서 ${fmtDistance(distance(me, sel))}` : ''}
          </p>
          <div className="map-card-actions">
            <button type="button" className="btn btn-primary" onClick={() => onShopOpen(sel.account_username, [sel.name])}>
              매장 정보
            </button>
            <a
              className="btn"
              href={
                sel.naver_place_id
                  ? `https://map.naver.com/p/entry/place/${sel.naver_place_id}`
                  : `https://map.naver.com/p/search/${encodeURIComponent(sel.address ?? sel.shop.display_name)}`
              }
              target="_blank"
              rel="noopener noreferrer"
            >
              네이버 길찾기
            </a>
          </div>
        </div>
      )}

      {!sel && nearby.length > 0 && (
        <div className="map-card">
          <div className="map-card-head">
            <b>가까운 매장</b>
          </div>
          <ul className="map-near">
            {nearby.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(p.id)
                    mapRef.current?.panTo(new window.kakao.maps.LatLng(p.lat, p.lng))
                  }}
                >
                  <span>
                    {p.shop.display_name} {branches.filter((x) => x.account_username === p.account_username).length > 1 ? p.name : ''}
                  </span>
                  <span className={`open-status ${p.status.kind}`}>{p.status.text}</span>
                  <span className="map-near-dist">{fmtDistance(p.dist)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {missing > 0 && <p className="map-note">위치 정보가 없는 지점 {missing}곳은 지도에 표시되지 않습니다.</p>}
    </div>
  )
}
