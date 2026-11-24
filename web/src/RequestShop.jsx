// 매장 추가 신청 창
import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabase.js'
import { track } from './track.js'
import { useScrollLock } from './useScrollLock.js'

// "https://www.instagram.com/shop_name/?hl=ko", "@shop_name", "shop_name" → "shop_name"
export function parseUsername(input) {
  const text = input.trim()
  const fromUrl = text.match(/instagram\.com\/([A-Za-z0-9._]+)/i)
  const name = (fromUrl ? fromUrl[1] : text.replace(/^@/, '')).toLowerCase()
  if (['p', 'reel', 'reels', 'stories', 'explore', 'accounts'].includes(name)) return null
  return /^[a-z0-9._]{1,30}$/.test(name) ? name : null
}

export default function RequestShop({ accounts, onClose }) {
  const [insta, setInsta] = useState('')
  const [name, setName] = useState('')
  const [region, setRegion] = useState('')
  const [note, setNote] = useState('')
  const [state, setState] = useState('idle') // idle | sending | done
  const [error, setError] = useState('')
  const dialogRef = useRef(null)

  useScrollLock() // 창이 열려 있는 동안 뒤 목록은 스크롤되지 않게

  // 창 열기 (Esc 키나 바깥을 누르면 닫힘)
  useEffect(() => {
    dialogRef.current?.showModal?.()
  }, [])

  const username = parseUsername(insta)
  const existing = username && accounts.find((a) => a.username === username)

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (!username) return setError('인스타그램 주소나 아이디를 확인해 주세요.')
    if (existing) return setError(`이미 있는 매장입니다: ${existing.display_name}`)
    setState('sending')
    const { error: err } = await supabase.from('shop_requests').insert({
      username,
      display_name: name.trim() || null,
      region: region.trim() || null,
      note: note.trim() || null,
    })
    if (err) {
      setState('idle')
      setError(err.code === '23505' ? '이미 신청된 매장입니다. 확인 후 추가될 예정이에요.' : '신청하지 못했습니다. 잠시 후 다시 시도해 주세요.')
      return
    }
    setState('done')
    track('request_submit', username)
  }

  return (
    <dialog
      ref={dialogRef}
      className="modal"
      aria-labelledby="request-title"
      onClose={onClose}
      onClick={(e) => e.target === dialogRef.current && onClose()}
    >
      <div className="modal-box">
        {state === 'done' ? (
          <div className="modal-done">
            <h2 id="request-title">신청했어요!</h2>
            <p>
              <b>@{username}</b> 매장을 확인한 뒤 추가할게요.
              <br />
              추가되면 목록에 바로 나타납니다.
            </p>
            <button type="button" className="btn btn-primary" onClick={onClose}>
              확인
            </button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <h2 id="request-title">매장 추가 신청</h2>
            <p className="modal-desc">보고 싶은 굿즈샵의 인스타그램을 알려주세요. 확인 후 추가됩니다.</p>

            <label className="field">
              <span>
                인스타그램 주소 또는 아이디 <em>필수</em>
              </span>
              <input
                value={insta}
                onChange={(e) => setInsta(e.target.value)}
                placeholder="예: instagram.com/goods_shop 또는 @goods_shop"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck="false"
                required
              />
              {insta && username && !existing && <small className="hint ok">@{username}</small>}
              {existing && <small className="hint warn">이미 있는 매장: {existing.display_name}</small>}
            </label>

            <label className="field">
              <span>매장 이름</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 굿즈상점" maxLength={40} />
            </label>

            <label className="field">
              <span>지역</span>
              <input value={region} onChange={(e) => setRegion(e.target.value)} placeholder="예: 홍대, 강남, 부산" maxLength={20} />
            </label>

            <label className="field">
              <span>하고 싶은 말</span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="예: 쿠지 입고가 많은 곳이에요"
                maxLength={300}
                rows={2}
              />
            </label>

            {error && <p className="form-error">{error}</p>}

            <div className="modal-actions">
              <button type="button" className="btn" onClick={onClose}>
                취소
              </button>
              <button type="submit" className="btn btn-primary" disabled={state === 'sending'}>
                {state === 'sending' ? '보내는 중…' : '신청하기'}
              </button>
            </div>
          </form>
        )}
      </div>
    </dialog>
  )
}
