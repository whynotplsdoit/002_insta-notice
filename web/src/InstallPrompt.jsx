// "홈 화면에 추가" 안내 (휴대폰에서만)
// - 안드로이드(크롬·삼성 인터넷): [추가] 버튼을 누르면 바로 설치 창
// - 아이폰(사파리): 설치 버튼이 없어서 "공유 → 홈 화면에 추가" 방법을 안내
// - 이미 홈 화면 앱으로 열었거나, 닫기를 누른 지 30일이 안 됐으면 안 보임
import { useEffect, useState } from 'react'

const DISMISS_KEY = 'goods-radar:install-dismissed'
const DISMISS_DAYS = 30
const SHOW_AFTER_MS = 8000

const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
// 카톡·인스타 같은 앱 안의 브라우저에서는 홈 화면 추가가 안 됨
const isInApp = () => /KAKAOTALK|Instagram|FBAN|FBAV|Line\/|NAVER\(inapp/i.test(navigator.userAgent)

function recentlyDismissed() {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) ?? 0)
    return Date.now() - at < DISMISS_DAYS * 86400000
  } catch {
    return false
  }
}

export default function InstallPrompt() {
  const [mode, setMode] = useState(null) // null | 'android' | 'ios' | 'inapp'
  const [deferred, setDeferred] = useState(null)

  useEffect(() => {
    if (isStandalone() || recentlyDismissed() || window.innerWidth >= 1024) return
    let timer
    const onPrompt = (e) => {
      e.preventDefault() // 브라우저 기본 안내 대신 우리 안내를 씀
      setDeferred(e)
      timer = setTimeout(() => setMode('android'), SHOW_AFTER_MS)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    if (isIos()) timer = setTimeout(() => setMode(isInApp() ? 'inapp' : 'ios'), SHOW_AFTER_MS)
    else if (isInApp()) timer = setTimeout(() => setMode('inapp'), SHOW_AFTER_MS)
    window.addEventListener('appinstalled', () => setMode(null))
    return () => {
      clearTimeout(timer)
      window.removeEventListener('beforeinstallprompt', onPrompt)
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
    if (!deferred) return
    deferred.prompt()
    const { outcome } = await deferred.userChoice
    setDeferred(null)
    if (outcome === 'accepted') setMode(null)
    else close()
  }

  if (!mode) return null
  return (
    <div className="install-banner" role="dialog" aria-label="홈 화면에 추가">
      <img src="/favicon-64.png" alt="" width="40" height="40" />
      <div className="install-text">
        <b>굿즈레이더를 홈 화면에 추가하세요</b>
        {mode === 'android' && <span>앱처럼 아이콘을 눌러 바로 열 수 있어요.</span>}
        {mode === 'ios' && (
          <span>
            아래 <b>공유</b> 버튼 <ShareIcon /> → <b>홈 화면에 추가</b>를 눌러 주세요.
          </span>
        )}
        {mode === 'inapp' && <span>오른쪽 위 메뉴에서 "다른 브라우저로 열기"를 누른 뒤 추가할 수 있어요.</span>}
      </div>
      {mode === 'android' && (
        <button type="button" className="install-add" onClick={install}>
          추가
        </button>
      )}
      <button type="button" className="install-close" onClick={close} aria-label="닫기">
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
