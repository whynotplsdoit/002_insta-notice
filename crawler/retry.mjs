// 인터넷이 잠깐 끊기거나 바뀐 오류(와이파이 재연결, VPN 켜고 끄기 등)는 15분 기다리지 않고 잠시 뒤 다시 시도
import { log as defaultLog } from './log.mjs'

export const NETWORK_ERR =
  /ERR_(NETWORK_CHANGED|INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|CONNECTION_(RESET|CLOSED|REFUSED|TIMED_OUT|ABORTED)|ADDRESS_UNREACHABLE|TIMED_OUT|NETWORK_IO_SUSPENDED)|Timeout \d+ms exceeded/
export const RETRY_WAITS = [30_000, 60_000] // 30초 뒤, 또 실패하면 60초 뒤 다시 시도

export const isNetworkError = (err) => NETWORK_ERR.test(String(err?.message ?? err))

// 오류 문구를 알아보기 쉽게: 첫 줄만, 화면 색 기호 제거, 인터넷 오류는 우리말로
export function shortError(err) {
  const msg = String(err?.message ?? err).replace(/\x1b\[[0-9;]*m/g, '').split('\n')[0].trim()
  const net = msg.match(NETWORK_ERR)
  return net ? `인터넷 연결이 잠깐 끊기거나 바뀌어 접속하지 못했습니다 (${net[0]})` : msg
}

// 인터넷 오류면 잠시 뒤 다시 시도 (그 밖의 오류는 바로 넘김)
export async function retryNetwork(label, fn, { waits = RETRY_WAITS, log = defaultLog } = {}) {
  for (let i = 0; ; i++) {
    try {
      return await fn()
    } catch (err) {
      if (!isNetworkError(err) || i >= waits.length) throw err
      await log(`↻ ${label}: ${shortError(err)} → ${waits[i] / 1000}초 뒤 다시 시도`)
      await new Promise((r) => setTimeout(r, waits[i]))
    }
  }
}
