// "홈 화면에 추가" 안내 (휴대폰에서만)
// - 안드로이드(크롬 등): [추가] → 휴대폰의 설치 창. 설치 창이 안 뜨면 브라우저 메뉴로 추가하는 방법을 보여줌
// - 삼성 인터넷: 설치 창 대신 메뉴로 추가하는 방법 안내
// - 아이폰(사파리): "공유 → 홈 화면에 추가" 안내
// - 카톡·인스타 등 앱 안의 브라우저: 다른 브라우저로 열기 안내
// - 이미 홈 화면 앱으로 열었거나, 닫기를 누른 지 30일이 안 됐으면 안 보임
import { useEffect, useRef, useState } from 'react'

const DISMISS_KEY = 'goods-radar:install-dismissed'
const DISMISS_DAYS = 30
const SHOW_AFTER_MS = 8000

const ua = () => navigator.userAgent
const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true
const isIos = () => /iphone|ipad|ipod/i.test(ua()) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const isSamsung = () => /SamsungBrowser/i.test(ua())
const isInApp = () => /KAKAOTALK|Instagram|FBAN|FBAV|Line\/|NAVER\(inapp|DaumApps/i.test(ua())
const isMobile = () => /Android|iPhone|iPad|iPod/i.test(ua()) || window.innerWidth < 1024

function recentlyDismissed() {
  try {
    return Date.now() - Number(localStorage.getItem(DISMISS_KEY) ?? 0) < DISMISS_DAYS * 86400000
  } catch {
    return false
  }
}

export default function InstallPrompt() {
  // null | 'android'(설치 창 가능) | 'menu'(메뉴로 추가 안내) | 'ios' | 'inapp' | 'installing'
  const [mode, setMode] = useState(null)
  const deferred = useRef(null)

  useEffect(() => {
    if (isStandalone() || recentlyDismissed() || !isMobile()) return
    const onPrompt = (e) => {
      e.preventDefault() // 브라우저 기본 안내 대신 우리 안내를 씀
      deferred.current = e
      setMode((m) => (m === 'menu' || m === null ? 'android' : m))
    }
    const onInstalled = () => setMode('installing')
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    // 일정 시간 뒤 안내 띄우기 (설치 창을 쓸 수 없는 브라우저는 메뉴 안내)
    const timer = setTimeout(() => {
      if (isInApp()) setMode('inapp')
      else if (isIos()) setMode('ios')
      else setMode(deferred.current ? 'android' : 'menu')
    }, SHOW_AFTER_MS)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const close = () => {
    setMode(null)
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()))
    } catch {
      // 저장 못 해도 괜찮음
    }
  }

  const install = async () => {
    const e = deferred.current
    deferred.current = null // 설치 창은 한 번만 띄울 수 있음
    if (!e) return setMode('menu')
    try {
      await e.prompt()
      const { outcome } = await e.userChoice
      if (outcome === 'accepted') setMode('installing')
      else close()
    } catch {
      setMode('menu') // 설치 창을 못 띄우면 메뉴로 추가하는 방법
    }
  }

  if (!mode) return null
  return (
    <div className="install-banner" role="dialog" aria-label="홈 화면에 추가">
      <img src="/favicon-64.png" alt="" width="40" height="40" />
      <div className="install-text">
        {mode === 'installing' ? (
          <>
            <b>설치하고 있어요</b>
            <span>잠시 뒤 홈 화면이나 앱 목록에 굿즈레이더 아이콘이 생겨요.</span>
          </>
        ) : (
          <>
            <b>굿즈레이더를 홈 화면에 추가하세요</b>
            {mode === 'android' && <span>앱처럼 아이콘을 눌러 바로 열 수 있어요.</span>}
            {mode === 'menu' &&
              (isSamsung() ? (
                <span>
                  아래 <b>≡ 메뉴</b> → <b>현재 페이지 추가</b> → <b>홈 화면</b>을 눌러 주세요.
                </span>
              ) : (
                <span>
                  오른쪽 위 <b>⋮ 메뉴</b> → <b>앱 설치</b> 또는 <b>홈 화면에 추가</b>를 눌러 주세요.
                </span>
              ))}
            {mode === 'ios' && (
              <span>
                아래 <b>공유</b> 버튼 <ShareIcon /> → <b>홈 화면에 추가</b>를 눌러 주세요.
              </span>
            )}
            {mode === 'inapp' && <span>오른쪽 위 메뉴에서 "다른 브라우저로 열기"를 누른 뒤 추가할 수 있어요.</span>}
          </>
        )}
      </div>
      {mode === 'android' && (
        <button type="button" className="install-add" onClick={install}>
          추가
        </button>
      )}
      <button type="button" className="install-close" onClick={mode === 'installing' ? () => setMode(null) : close} aria-label="닫기">
        ✕
      </button>
    </div>
  )
}

const ShareIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ verticalAlign: '-2px' }}>
    <path d="M12 3v12" />
    <polyline points="8 7 12 3 16 7" />
    <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
  </svg>
)
