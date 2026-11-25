// 매장 신청: 승인(→ PC 크롤러가 15분 안에 팔로우·첫 수집) / 거절
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../supabase.js'
import { ACCOUNT_TYPES, fmtTime } from './util.js'

const STATUS = {
  pending: { label: '대기', cls: 'warn' },
  approved: { label: '승인됨 · 추가 대기 중', cls: 'info' },
  done: { label: '추가 완료', cls: 'ok' },
  failed: { label: '추가 실패', cls: 'err' },
  rejected: { label: '거절', cls: 'mute' },
}

// 직접 거절할 때 고르는 이유 (슬랙 web/api/slack.js 와 같은 목록)
const REJECT_REASONS = ['굿즈샵 아님', '이미 등록됨', '운영 안 함', '계정 없음·비공개', '기타']

export default function Requests({ onChange }) {
  const [rows, setRows] = useState(null)
  const [existing, setExisting] = useState(new Set())

  const load = useCallback(async () => {
    const [r, a] = await Promise.all([
      supabase.from('shop_requests').select('*').order('created_at', { ascending: false }).limit(100),
      supabase.from('accounts').select('username'),
    ])
    setRows(r.data ?? [])
    setExisting(new Set((a.data ?? []).map((x) => x.username)))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const update = async (id, patch) => {
    const { error } = await supabase.from('shop_requests').update({ ...patch, reviewed_at: new Date().toISOString() }).eq('id', id)
    if (error) return alert(`저장하지 못했습니다: ${error.message}`)
    await load()
    onChange?.()
  }

  if (!rows) return <p className="a-empty">불러오는 중…</p>
  const open = rows.filter((r) => r.status === 'pending')
  const rest = rows.filter((r) => r.status !== 'pending')

  return (
    <div className="a-stack">
      <section>
        <h2 className="a-h2">처리할 신청 {open.length}개</h2>
        {open.length === 0 && <p className="a-empty">대기 중인 신청이 없습니다.</p>}
        {open.map((r) => (
          <PendingCard key={r.id} req={r} exists={existing.has(r.username)} onUpdate={update} />
        ))}
      </section>

      {rest.length > 0 && (
        <section>
          <h2 className="a-h2">처리 내역</h2>
          <div className="a-card a-list">
            {rest.map((r) => (
              <div key={r.id} className="a-row">
                <div className="a-row-main">
                  <a href={`https://www.instagram.com/${r.username}/`} target="_blank" rel="noopener noreferrer">
                    @{r.username}
                  </a>
                  {r.display_name && <span className="a-muted"> · {r.display_name}</span>}
                  {r.auto_approved && <span className="a-pill info"> 자동 승인</span>}
                  {r.result && <div className="a-muted a-small-text">{r.result}</div>}
                  {r.auto_note && r.status !== 'rejected' && <div className="a-muted a-small-text">🔎 {r.auto_note}</div>}
                </div>
                <span className={`a-pill ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span>
                {r.status === 'failed' && (
                  <button className="a-btn a-small" onClick={() => update(r.id, { status: 'approved', result: null })}>
                    다시 시도
                  </button>
                )}
              </div>
            ))}
          </div>
          <p className="a-muted a-small-text">
            승인하면 이 PC의 크롤러가 15분 안에 부계정 팔로우와 첫 수집을 하고 매장 목록에 추가합니다. 새 신청은 크롤러가 먼저
            자동 검토해서, 확실한 곳은 바로 추가하고(하루 최대 3곳) 확실히 아닌 곳은 거절합니다. 추가가 끝난 신청은 바로 지워지고(매장
            목록에서 확인), 거절된 신청은 이유와 함께 30일 동안 남습니다.
          </p>
        </section>
      )}
    </div>
  )
}

function PendingCard({ req, exists, onUpdate }) {
  const [name, setName] = useState(req.display_name ?? '')
  const [region, setRegion] = useState(req.region ?? '')
  const [type, setType] = useState(req.account_type ?? '굿즈샵')
  const [rejecting, setRejecting] = useState(false)

  const reject = (reason) => {
    let why = reason
    if (reason === '기타') {
      const typed = prompt('거절 이유를 한 줄로 적어 주세요. (비워도 됩니다)', '')
      if (typed === null) return // 취소
      why = typed.trim() ? `기타: ${typed.trim().slice(0, 200)}` : '기타'
    }
    onUpdate(req.id, { status: 'rejected', result: `거절: ${why} (관리자)` })
  }

  return (
    <div className="a-card a-request">
      <div className="a-request-head">
        <a className="a-strong" href={`https://www.instagram.com/${req.username}/`} target="_blank" rel="noopener noreferrer">
          @{req.username} ↗
        </a>
        <span className="a-muted a-small-text">{fmtTime(req.created_at)} 신청</span>
      </div>
      {req.note && <p className="a-note">“{req.note}”</p>}
      <p className="a-muted a-small-text">
        🔎 {req.auto_note ?? '자동 검토 대기 중 (PC 크롤러가 9~24시에 인스타·네이버를 확인합니다)'}
        {req.naver_place_id && (
          <>
            {' '}
            <a href={`https://map.naver.com/p/entry/place/${req.naver_place_id}`} target="_blank" rel="noopener noreferrer">
              네이버 지도 ↗
            </a>
          </>
        )}
      </p>
      {exists && <p className="a-error">이미 등록된 매장입니다. 거절하세요.</p>}
      <div className="a-grid3">
        <label className="a-field">
          <span>매장 이름</span>
          <input className="a-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="비우면 인스타 이름" />
        </label>
        <label className="a-field">
          <span>지역</span>
          <input className="a-input" value={region} onChange={(e) => setRegion(e.target.value)} placeholder="예: 홍대" />
        </label>
        <label className="a-field">
          <span>종류</span>
          <select className="a-input" value={type} onChange={(e) => setType(e.target.value)}>
            {ACCOUNT_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
      </div>
      <p className="a-muted a-small-text">인스타 링크를 열어 굿즈샵이 맞는지, 공개 계정인지 확인한 뒤 승인하세요.</p>
      {rejecting && (
        <div className="a-actions">
          <span className="a-muted a-small-text">거절 이유:</span>
          {REJECT_REASONS.map((r) => (
            <button key={r} className="a-btn a-small a-danger" onClick={() => reject(r)}>
              {r}
            </button>
          ))}
          <button className="a-btn a-small" onClick={() => setRejecting(false)}>
            취소
          </button>
        </div>
      )}
      <div className="a-actions">
        <button className="a-btn" onClick={() => setRejecting((v) => !v)}>
          거절
        </button>
        <button
          className="a-btn a-primary"
          disabled={exists}
          onClick={() =>
            onUpdate(req.id, {
              status: 'approved',
              display_name: name.trim() || null,
              region: region.trim() || null,
              account_type: type,
            })
          }
        >
          승인
        </button>
      </div>
    </div>
  )
}
