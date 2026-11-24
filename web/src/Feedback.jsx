// 의견 보내기 창: 관리자 화면 '의견' 탭에 쌓이고 카톡·슬랙으로 알림
// 연락처 등 개인정보는 받지 않음 (기기·브라우저 이름만 오류 확인용으로 함께 저장)
import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabase.js'
import { useScrollLock } from './useScrollLock.js'
import { useBackToClose } from './useBackToClose.js'

const KINDS = [
  { id: '의견', hint: '이런 기능이 있으면 좋겠어요, 이런 점이 불편해요' },
  { id: '오류', hint: '화면이 이상하거나 버튼이 안 눌려요' },
  { id: '정보 수정', hint: '분류·일정·영업시간이 틀렸어요' },
]

export default function Feedback({ context, onClose }) {
  const [kind, setKind] = useState('의견')
  const [message, setMessage] = useState('')
  const [state, setState] = useState('idle') // idle | sending | done
  const [error, setError] = useState('')
  const dialogRef = useRef(null)

  useScrollLock() // 창이 열려 있는 동안 뒤 목록은 스크롤되지 않게
  useBackToClose(onClose) // 휴대폰 뒤로 가기로 닫기
  useEffect(() => {
    dialogRef.current?.showModal?.()
  }, [])

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    const text = message.trim()
    if (text.length < 2) return setError('내용을 조금 더 적어 주세요.')
    setState('sending')
    const { error: err } = await supabase.from('feedback').insert({
      kind,
      message: text,
      context: context?.slice(0, 200) || null,
      ua: navigator.userAgent.slice(0, 300),
    })
    if (err) {
      setState('idle')
      setError('보내지 못했습니다. 잠시 후 다시 시도해 주세요.')
      return
    }
    setState('done')
  }

  return (
    <dialog
      ref={dialogRef}
      className="modal"
      aria-labelledby="feedback-title"
      onClose={onClose}
      onClick={(e) => e.target === dialogRef.current && onClose()}
    >
      <div className="modal-box">
        {state === 'done' ? (
          <div className="modal-done">
            <h2 id="feedback-title">보내 주셔서 고마워요!</h2>
            <p>
              보내 주신 내용은 꼼꼼히 읽고
              <br />
              굿즈레이더를 고치는 데 쓸게요.
            </p>
            <button type="button" className="btn btn-primary" onClick={onClose}>
              확인
            </button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <h2 id="feedback-title">의견 보내기</h2>
            <p className="modal-desc">불편한 점, 바라는 기능, 틀린 정보 무엇이든 알려주세요.</p>

            <div className="chips feedback-kinds" role="radiogroup" aria-label="종류">
              {KINDS.map((k) => (
                <button
                  key={k.id}
                  type="button"
                  role="radio"
                  aria-checked={kind === k.id}
                  className={`chip${kind === k.id ? ' on' : ''}`}
                  onClick={() => setKind(k.id)}
                >
                  {k.id}
                </button>
              ))}
            </div>

            <label className="field">
              <span>
                내용 <em>필수</em>
              </span>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={`예: ${KINDS.find((k) => k.id === kind).hint}`}
                maxLength={1000}
                rows={5}
                required
              />
              <small className="hint">{message.length}/1000 · 답장은 드리지 못해요. 연락처는 적지 말아 주세요.</small>
            </label>

            {error && <p className="form-error">{error}</p>}

            <div className="modal-actions">
              <button type="button" className="btn" onClick={onClose}>
                취소
              </button>
              <button type="submit" className="btn btn-primary" disabled={state === 'sending'}>
                {state === 'sending' ? '보내는 중…' : '보내기'}
              </button>
            </div>
          </form>
        )}
      </div>
    </dialog>
  )
}
