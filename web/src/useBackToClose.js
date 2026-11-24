// 휴대폰 "뒤로 가기"로 창(상세, 매장 정보, 매장 신청)을 닫기
// - 창이 열릴 때 방문 기록을 하나 쌓고, 뒤로 가기를 누르면 맨 위 창 하나만 닫음
// - X 버튼이나 바깥을 눌러 닫으면 쌓아 둔 기록도 같이 지움 (뒤로 가기를 두 번 눌러야 하는 일 없게)
// - 창 여러 개가 한꺼번에 닫혀도 기록을 한 번에 정리
import { useEffect, useRef } from 'react'

const stack = [] // 열린 창 순서 [{ id, close }]
let nextId = 1
let pendingBacks = 0 // 지워야 할 기록 수 (X로 닫은 창)
let ignorePops = 0 // 우리가 직접 뒤로 보낸 것이라 무시할 popstate 수
let flushTimer = null

function flushBacks() {
  flushTimer = null
  if (pendingBacks > 0) {
    ignorePops++
    history.go(-pendingBacks)
    pendingBacks = 0
  }
}

if (typeof window !== 'undefined') {
  // 창을 열고 닫으며 기록이 오갈 때 브라우저가 스크롤 위치를 멋대로 바꾸지 않게
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual'
  window.addEventListener('popstate', () => {
    if (ignorePops > 0) {
      ignorePops--
      return
    }
    const top = stack.pop() // 뒤로 가기 → 맨 위 창 닫기
    top?.close()
  })
}

export function useBackToClose(onClose) {
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const id = nextId++
    stack.push({ id, close: () => closeRef.current() })
    history.pushState({ sheet: id }, '')
    return () => {
      const i = stack.findIndex((e) => e.id === id)
      if (i === -1) return // 뒤로 가기로 닫힘 (기록은 이미 빠짐)
      stack.splice(i, 1) // X·바깥 눌러 닫음 → 쌓아 둔 기록 지우기
      pendingBacks++
      if (!flushTimer) flushTimer = setTimeout(flushBacks, 0)
    }
  }, [])
}
