// 사용자 의견: 새 의견 → [보관] (나중에 처리) 또는 [삭제] (완전히 지움)
// 스팸함: 검사 서버가 자동으로 거른 의견 → [복원] 또는 [삭제] (30일 뒤 자동 삭제)
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

  const keep = async (id) => {
    const { error } = await supabase.from('feedback').update({ status: 'kept', checked_at: new Date().toISOString() }).eq('id', id)
    if (error) return alert(`보관하지 못했습니다: ${error.message}`)
    await load()
    onChange?.()
  }

  const remove = async (id) => {
    if (!confirm('이 의견을 삭제할까요? 되돌릴 수 없습니다.')) return
    const { data, error } = await supabase.from('feedback').delete().eq('id', id).select('id')
    if (error) return alert(`삭제하지 못했습니다: ${error.message}`)
    if (!data?.length) return alert('삭제 권한이 없습니다. (supabase/14-feedback-status.sql 실행 필요)')
    await load()
    onChange?.()
  }

  // 스팸함 → 새 의견으로 되돌리기
  const restore = async (id) => {
    const { error } = await supabase.from('feedback').update({ status: 'new' }).eq('id', id)
    if (error) return alert(`복원하지 못했습니다: ${error.message}`)
    await load()
    onChange?.()
  }

  if (!rows) return <p className="a-empty">불러오는 중…</p>
  const fresh = rows.filter((r) => r.status === 'new')
  const kept = rows.filter((r) => r.status === 'kept')
  const spam = rows.filter((r) => r.status === 'spam')

  const card = (r) => (
    <div key={r.id} className="a-card a-request">
      <div className="a-request-head">
        <span>
          <span className={`a-pill ${KIND_CLS[r.kind] ?? 'mute'}`}>{r.kind}</span>
          {r.tag && <span className="a-pill mute"> #{r.tag}</span>}
        </span>
        <span className="a-muted a-small-text">{fmtTime(r.created_at)}</span>
      </div>
      <p className="a-note" style={{ whiteSpace: 'pre-wrap' }}>
        {r.message}
      </p>
      <p className="a-muted a-small-text">{[r.context, device(r.ua ?? '')].filter(Boolean).join(' · ')}</p>
      {r.filter_note && <p className="a-muted a-small-text">🤖 {r.filter_note}</p>}
      <div className="a-actions">
        {r.status === 'new' && (
          <button className="a-btn a-primary" onClick={() => keep(r.id)}>
            보관
          </button>
        )}
        {r.status === 'spam' && (
          <button className="a-btn a-primary" onClick={() => restore(r.id)}>
            복원
          </button>
        )}
        <button className="a-btn a-danger" onClick={() => remove(r.id)}>
          삭제
        </button>
      </div>
    </div>
  )

  return (
    <div className="a-stack">
      <p className="a-muted a-small-text">나중에 처리할 의견은 [보관], 필요 없거나 처리가 끝난 의견은 [삭제] (완전히 지워집니다).</p>
      <section>
        <h2 className="a-h2">새 의견 {fresh.length}개</h2>
        {fresh.length === 0 && <p className="a-empty">새로 온 의견이 없습니다.</p>}
        {fresh.map(card)}
      </section>
      {kept.length > 0 && (
        <section>
          <h2 className="a-h2">보관한 의견 {kept.length}개</h2>
          {kept.map(card)}
        </section>
      )}
      {spam.length > 0 && (
        <details className="a-spam">
          <summary className="a-h2">🗑 스팸함 {spam.length}개</summary>
          <p className="a-muted a-small-text">
            자동으로 걸러진 의견입니다 (자음·모음 남발, 욕설만, 광고). 잘못 걸러졌으면 [복원], 30일 지나면 자동 삭제됩니다.
          </p>
          {spam.map(card)}
        </details>
      )}
    </div>
  )
}
