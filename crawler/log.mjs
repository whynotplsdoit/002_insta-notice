// 수집 기록: 화면 + data/crawl-log.txt + DB(관리자 화면 "수집 상태"에서 보임)
import fs from 'node:fs/promises'
import { db } from './db.mjs'

export async function log(message, { level = 'info', account = null } = {}) {
  const time = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
  const line = `[${time}] ${message}`
  console.log(line)
  try {
    await fs.mkdir('data', { recursive: true })
    await fs.appendFile('data/crawl-log.txt', line + '\n', 'utf8')
  } catch {
    // 파일 기록 실패는 무시
  }
  // DB 기록 실패는 수집을 멈추지 않음
  await db.from('crawl_logs').insert({ level, account_username: account, message }).then(
    () => {},
    () => {},
  )
}
