// 매장 관리: 이름·종류·수집 간격·숨기기·고정 해시태그·지점 수정, 삭제
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../supabase.js'
import { ACCOUNT_TYPES, ago, fromList, toList } from './util.js'

// 네이버 지도 링크에서 장소 번호 뽑기 (map.naver.com/p/entry/place/123…, m.place.naver.com/place/123, 숫자만)
const placeIdOf = (text) => {
  const t = text.trim()
  if (!t) return null
  return t.match(/place\/(\d{5,})/)?.[1] ?? (/^\d{5,}$/.test(t) ? t : null)
}

export default function Shops() {
  const [shops, setShops] = useState(null)
  const [branches, setBranches] = useState([])
  const [counts, setCounts] = useState(new Map())
  const [openId, setOpenId] = useState(null)

  const load = useCallback(async () => {
    const [a, b, p] = await Promise.all([
      supabase.from('accounts').select('*').order('display_name'),
      supabase.from('branches').select('*').order('id'),
      supabase.from('posts').select('account_username').limit(10000),
    ])
    const m = new Map()
    for (const x of p.data ?? []) m.set(x.account_username, (m.get(x.account_username) ?? 0) + 1)
    setShops(a.data ?? [])
    setBranches(b.data ?? [])
    setCounts(m)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  if (!shops) return <p className="a-empty">불러오는 중…</p>

  return (
    <div className="a-stack">
      <h2 className="a-h2">매장 {shops.length}곳</h2>
      <div className="a-card a-list">
        {shops.map((s) => (
          <div key={s.username} className={`a-shop${s.hidden ? ' is-hidden' : ''}`}>
            <button className="a-row a-row-btn" onClick={() => setOpenId(openId === s.username ? null : s.username)}>
              <div className="a-row-main">
                <span className="a-strong">{s.display_name}</span>
                <span className="a-muted"> @{s.username}</span>
                <div className="a-muted a-small-text">
                  {s.account_type} · {s.crawl_interval_hours}시간 간격 · 글 {counts.get(s.username) ?? 0}개 · 마지막 수집 {ago(s.last_crawled_at)}
                </div>
              </div>
              {s.hidden && <span className="a-pill mute">숨김</span>}
              <span className="a-chevron">{openId === s.username ? '▲' : '▼'}</span>
            </button>
            {openId === s.username && (
              <ShopEditor
                shop={s}
                branches={branches.filter((b) => b.account_username === s.username)}
                onSaved={load}
                onDeleted={() => {
                  setOpenId(null)
                  load()
                }}
              />
            )}
          </div>
        ))}
      </div>
      <p className="a-muted a-small-text">숨긴 매장은 사이트에 보이지 않고 수집도 멈춥니다. 새 매장은 "매장 신청" 탭에서 승인해 추가합니다.</p>
    </div>
  )
}

function ShopEditor({ shop, branches, onSaved, onDeleted }) {
  const [form, setForm] = useState({
    display_name: shop.display_name,
    account_type: shop.account_type,
    crawl_interval_hours: shop.crawl_interval_hours,
    hidden: shop.hidden,
    fixed_hashtags: fromList(shop.fixed_hashtags),
  })
  const [list, setList] = useState(
    branches.map((b) => ({
      ...b,
      aliasText: fromList(b.aliases),
      naverText: b.naver_place_id ? `https://map.naver.com/p/entry/place/${b.naver_place_id}` : '',
    })),
  )
  const [removed, setRemoved] = useState([])
  const [saving, setSaving] = useState(false)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const setBranch = (i, k, v) => setList(list.map((b, j) => (j === i ? { ...b, [k]: v } : b)))

  const save = async () => {
    if (!form.display_name.trim()) return alert('매장 이름을 입력하세요.')
    if (list.some((b) => !b.name.trim())) return alert('지점 이름을 입력하세요.')
    const bad = list.find((b) => b.naverText?.trim() && !placeIdOf(b.naverText))
    if (bad) return alert(`'${bad.name}' 지점의 네이버 지도 링크에서 장소 번호를 찾지 못했습니다.\nmap.naver.com 에서 매장을 연 뒤 주소창의 링크를 붙여넣어 주세요.`)
    setSaving(true)
    const errors = []
    const r = await supabase
      .from('accounts')
      .update({
        display_name: form.display_name.trim(),
        account_type: form.account_type,
        crawl_interval_hours: Math.max(1, Number(form.crawl_interval_hours) || 6),
        hidden: form.hidden,
        fixed_hashtags: toList(form.fixed_hashtags).map((t) => t.replace(/^#/, '')),
      })
      .eq('username', shop.username)
    if (r.error) errors.push(r.error.message)
    for (const id of removed) {
      const d = await supabase.from('branches').delete().eq('id', id)
      if (d.error) errors.push(d.error.message)
    }
    for (const b of list) {
      const placeId = placeIdOf(b.naverText ?? '')
      const row = {
        name: b.name.trim(),
        region: b.region?.trim() || null,
        address: b.address?.trim() || null,
        phone: b.phone?.trim() || null,
        hours_note: b.hours_note?.trim() || null,
        info_manual: Boolean(b.info_manual),
        aliases: toList(b.aliasText ?? ''),
        naver_place_id: placeId,
        // 네이버 장소가 바뀌면 다음 자동 확인 때 바로 다시 읽도록
        ...(placeId !== (b.naver_place_id ?? null) ? { naver_updated_at: null } : {}),
      }
      const q = b.id
        ? await supabase.from('branches').update(row).eq('id', b.id)
        : await supabase.from('branches').insert({ ...row, account_username: shop.username })
      if (q.error) errors.push(q.error.message)
    }
    setSaving(false)
    if (errors.length) return alert(`일부 저장 실패:\n${errors.join('\n')}`)
    onSaved()
  }

  const remove = async () => {
    if (!confirm(`'${shop.display_name}' 매장과 수집한 글·사진을 모두 삭제할까요?\n되돌릴 수 없습니다. 잠시 빼려면 "숨기기"를 쓰세요.`)) return
    // 사진 파일 먼저 지움 (매장을 지우면 글은 DB에서 같이 지워지지만 사진 파일은 남기 때문)
    const { data: pics, error: pe } = await supabase.from('posts').select('image_path').eq('account_username', shop.username).not('image_path', 'is', null)
    if (pe) return alert(`삭제하지 못했습니다: ${pe.message}`)
    const { data: acct } = await supabase.from('accounts').select('profile_image_path').eq('username', shop.username).maybeSingle()
    const paths = [...pics.map((p) => p.image_path), acct?.profile_image_path].filter(Boolean)
    for (let i = 0; i < paths.length; i += 100) {
      const { error: se } = await supabase.storage.from('post-images').remove(paths.slice(i, i + 100))
      if (se) return alert(`사진을 지우지 못해 멈췄습니다: ${se.message}`)
    }
    const { error } = await supabase.from('accounts').delete().eq('username', shop.username)
    if (error) return alert(`삭제하지 못했습니다: ${error.message}`)
    onDeleted()
  }

  return (
    <div className="a-editor">
      <div className="a-grid3">
        <label className="a-field">
          <span>매장 이름</span>
          <input className="a-input" value={form.display_name} onChange={set('display_name')} />
        </label>
        <label className="a-field">
          <span>종류</span>
          <select className="a-input" value={form.account_type} onChange={set('account_type')}>
            {ACCOUNT_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="a-field">
          <span>정기 확인 간격 (시간)</span>
          <input className="a-input" type="number" min="1" max="72" value={form.crawl_interval_hours} onChange={set('crawl_interval_hours')} />
        </label>
      </div>
      <label className="a-field">
        <span>고정 해시태그 (쉼표로 구분, 분류할 때 무시)</span>
        <input className="a-input" value={form.fixed_hashtags} onChange={set('fixed_hashtags')} placeholder="예: 시로상점, 홍대굿즈샵" />
      </label>

      <div className="a-field">
        <span>지점</span>
        {list.map((b, i) => (
          <div key={b.id ?? `new-${i}`} className="a-branch-box">
            <div className="a-branch">
              <input className="a-input" value={b.name} onChange={(e) => setBranch(i, 'name', e.target.value)} placeholder="지점 이름 (예: 홍대점)" />
              <input className="a-input" value={b.region ?? ''} onChange={(e) => setBranch(i, 'region', e.target.value)} placeholder="지역 (예: 홍대)" />
              <input
                className="a-input"
                value={b.aliasText ?? ''}
                onChange={(e) => setBranch(i, 'aliasText', e.target.value)}
                placeholder="글에서 지점을 알아볼 단어 (쉼표)"
              />
              <button
                className="a-btn a-small"
                onClick={() => {
                  if (b.id) setRemoved([...removed, b.id])
                  setList(list.filter((_, j) => j !== i))
                }}
              >
                빼기
              </button>
            </div>
            <input
              className="a-input"
              value={b.naverText ?? ''}
              onChange={(e) => setBranch(i, 'naverText', e.target.value)}
              placeholder="네이버 지도 링크 (map.naver.com 에서 매장을 열고 주소창 링크 붙여넣기)"
            />
            <div className="a-branch-info">
              <input className="a-input" value={b.address ?? ''} onChange={(e) => setBranch(i, 'address', e.target.value)} placeholder="주소" />
              <input className="a-input" value={b.phone ?? ''} onChange={(e) => setBranch(i, 'phone', e.target.value)} placeholder="전화번호" />
            </div>
            <input
              className="a-input"
              value={b.hours_note ?? ''}
              onChange={(e) => setBranch(i, 'hours_note', e.target.value)}
              placeholder="영업시간 메모 (예: 매주 화요일 휴무, 공휴일 단축 영업)"
            />
            <div className="a-branch-foot">
              <label className="a-check">
                <input type="checkbox" checked={Boolean(b.info_manual)} onChange={(e) => setBranch(i, 'info_manual', e.target.checked)} />
                직접 입력한 정보 유지 (네이버 갱신이 주소·전화·영업시간을 덮어쓰지 않음)
              </label>
              <span className="a-muted a-small-text">
                {b.naver_place_id
                  ? `네이버: ${b.naver_name ?? '-'} · ${b.hours ? '영업시간 있음' : '영업시간 없음'} · ${b.naver_updated_at ? ago(b.naver_updated_at) + ' 갱신' : '갱신 대기'}`
                  : '네이버 미연결'}
              </span>
            </div>
          </div>
        ))}
        <button className="a-btn a-small a-add" onClick={() => setList([...list, { name: '', region: '', aliasText: '' }])}>
          + 지점 추가
        </button>
      </div>

      <label className="a-check">
        <input type="checkbox" checked={form.hidden} onChange={set('hidden')} />
        숨기기 (사이트에서 안 보이고 수집도 멈춤)
      </label>

      <div className="a-actions">
        <button className="a-btn a-danger" onClick={remove}>
          삭제
        </button>
        <span className="a-spacer" />
        <a className="a-btn" href={`https://www.instagram.com/${shop.username}/`} target="_blank" rel="noopener noreferrer">
          인스타 ↗
        </a>
        <button className="a-btn a-primary" onClick={save} disabled={saving}>
          {saving ? '저장 중…' : '저장'}
        </button>
      </div>
    </div>
  )
}
