// 사용자 의견: 새 의견 → [확인함] 으로 정리
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../supabase.js'
import { fmtTime } from './util.js'

const KIND_CLS = { 의견: 'info', 오류: 'err', '정보 수정': 'warn' }

// 기기·브라우저 이름만 짧게
function device(ua = '') {
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : ''
  const br = /SamsungBrowser/.test(ua)
    ? '삼성 인터넷'
    : /KAKAOTALK/i.test(ua)
      ? '카톡'
      : /Instagram/.test(ua)
        ? '인스타'
        : /Edg\//.test(ua)
          ? 'Edge'
          : /CriOS|Chrome/.test(ua)
            ? '크롬'
            : /Safari/.test(ua)
              ? '사파리'
              : ''
  return [os, br].filter(Boolean).join(' · ')
}

export default function Feedback({ onChange }) {
  const [rows, setRows] = useState(null)

  const load = useCallback(async () => {
    const { data } = await supabase.from('feedback').select('*').order('created_at', { ascending: false }).limit(200)
    setRows(data ?? [])
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const setStatus = async (id, status) => {
    const { error } = await supabase
      .from('feedback')
      .update({ status, checked_at: status === 'done' ? new Date().toISOString() : null })
      .eq('id', id)
    if (error) return alert(`저장하지 못했습니다: ${error.message}`)
    await load()
    onChange?.()
  }

  if (!rows) return <p className="a-empty">불러오는 중…</p>
  const fresh = rows.filter((r) => r.status === 'new')
  const done = rows.filter((r) => r.status === 'done')

  const card = (r) => (
    <div key={r.id} className="a-card a-request">
      <div className="a-request-head">
        <span className={`a-pill ${KIND_CLS[r.kind] ?? 'mute'}`}>{r.kind}</span>
        <span className="a-muted a-small-text">{fmtTime(r.created_at)}</span>
      </div>
      <p className="a-note" style={{ whiteSpace: 'pre-wrap' }}>
        {r.message}
      </p>
      <p className="a-muted a-small-text">{[r.context, device(r.ua ?? '')].filter(Boolean).join(' · ')}</p>
      <div className="a-actions">
        {r.status === 'new' ? (
          <button className="a-btn a-primary" onClick={() => setStatus(r.id, 'done')}>
            확인함
          </button>
        ) : (
          <button className="a-btn a-small" onClick={() => setStatus(r.id, 'new')}>
            다시 새 의견으로
          </button>
        )}
      </div>
    </div>
  )

  return (
    <div className="a-stack">
      <section>
        <h2 className="a-h2">새 의견 {fresh.length}개</h2>
        {fresh.length === 0 && <p className="a-empty">새로 온 의견이 없습니다.</p>}
        {fresh.map(card)}
      </section>
      {done.length > 0 && (
        <section>
          <h2 className="a-h2">확인한 의견</h2>
          {done.map(card)}
        </section>
      )}
    </div>
  )
}
