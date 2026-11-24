// 창(매장 정보, 매장 추가 신청)이 열려 있는 동안 뒤 화면이 스크롤되지 않게 막음
// 아이폰 사파리는 overflow:hidden 만으로는 막히지 않아서 body 를 그 자리에 고정했다가
// 창을 닫으면 원래 보던 위치로 되돌림
import { useEffect } from 'react'

let locks = 0 // 창이 여러 개 겹쳐도 마지막 창이 닫힐 때만 풀기
let savedY = 0

export function useScrollLock(active = true) {
  useEffect(() => {
    if (!active) return
    const body = document.body
    if (locks === 0) {
      savedY = window.scrollY
      Object.assign(body.style, { position: 'fixed', top: `-${savedY}px`, left: '0', right: '0', width: '100%', overflow: 'hidden' })
    }
    locks++
    return () => {
      locks--
      if (locks === 0) {
        Object.assign(body.style, { position: '', top: '', left: '', right: '', width: '', overflow: '' })
        window.scrollTo(0, savedY)
      }
    }
  }, [active])
}
