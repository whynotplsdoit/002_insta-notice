// 매장 추가 신청 창
import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabase.js'
import { track } from './track.js'
import { useScrollLock } from './useScrollLock.js'
import { useBackToClose } from './useBackToClose.js'

// "https://www.instagram.com/shop_name/?hl=ko", "@shop_name", "shop_name" → "shop_name"
export function parseUsername(input) {
  const text = input.trim()
  const fromUrl = text.match(/instagram\.com\/([A-Za-z0-9._]+)/i)
  const name = (fromUrl ? fromUrl[1] : text.replace(/^@/, '')).toLowerCase()
  if (['p', 'reel', 'reels', 'stories', 'explore', 'accounts'].includes(name)) return null
  return /^[a-z0-9._]{1,30}$/.test(name) ? name : null
}

// 지도 공유 글("[네이버 지도] 매장 … https://naver.me/abc")에서 네이버·카카오 지도 주소만 뽑기
// 반환: '' (안 적음) | 주소 | null (지도 주소 아님)
const MAP_HOST = /^(naver\.me|(m\.)?map\.naver\.com|((m|pcmap)\.)?place\.naver\.com|kko\.to|kko\.kakao\.com|place\.map\.kakao\.com|(m\.)?map\.kakao\.com)$/i
export function parseMapUrl(input) {
  const text = input.trim()
  if (!text) return ''
  const raw = text.match(/https?:\/\/[^\s<>"']+/i)?.[0] ?? (/^(naver\.me|kko\.to|[a-z.]*map\.(naver|kakao)\.com|[a-z.]*place\.naver\.com)\//i.test(text) ? `https://${text.split(/\s/)[0]}` : null)
  if (!raw || raw.length > 300) return null
  try {
    return MAP_HOST.test(new URL(raw).hostname) ? raw : null
  } catch {
    return null
  }
}

export default function RequestShop({ accounts, onClose }) {
  const [insta, setInsta] = useState('')
  const [mapLink, setMapLink] = useState('')
  const [note, setNote] = useState('')
  const [state, setState] = useState('idle') // idle | sending | done
  const [error, setError] = useState('')
  const dialogRef = useRef(null)

  useScrollLock() // 창이 열려 있는 동안 뒤 목록은 스크롤되지 않게
  useBackToClose(onClose) // 휴대폰 뒤로 가기로 닫기

  // 창 열기 (Esc 키나 바깥을 누르면 닫힘)
  useEffect(() => {
    dialogRef.current?.showModal?.()
  }, [])

  const username = parseUsername(insta)
  const existing = username && accounts.find((a) => a.username === username)
  const mapUrl = parseMapUrl(mapLink)

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (!username) return setError('인스타그램 주소나 아이디를 확인해 주세요.')
    if (existing) return setError(`이미 있는 매장입니다: ${existing.display_name}`)
    if (mapUrl === null) return setError('지도 링크는 네이버·카카오 지도 링크만 넣어 주세요.')
    setState('sending')
    const { error: err } = await supabase.from('shop_requests').insert({
      username,
      note: note.trim() || null,
      ...(mapUrl ? { map_url: mapUrl } : {}),
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
            <p className="modal-desc">
              <b>인스타그램만 알려주시면 돼요.</b> 나머지는 몰라도 괜찮아요.
            </p>

            <label className="field field-required">
              <span>
                인스타그램 주소 또는 아이디 <em className="tag-required">필수</em>
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

            <div className="field-divider">
              <span>선택 입력</span>
            </div>

            <label className="field field-optional">
              <span>
                지도 링크 (네이버·카카오) <i className="tag-optional">선택</i>
              </span>
              <input
                value={mapLink}
                onChange={(e) => setMapLink(e.target.value)}
                placeholder="지도 앱의 [공유] → 링크 복사 후 붙여넣기"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck="false"
                inputMode="url"
              />
              {mapLink && mapUrl && <small className="hint ok">지도 링크 확인됨</small>}
              {mapLink && mapUrl === null && <small className="hint warn">네이버·카카오 지도 링크가 아니에요</small>}
            </label>

            <label className="field field-optional">
              <span>
                하고 싶은 말 <i className="tag-optional">선택</i>
              </span>
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
