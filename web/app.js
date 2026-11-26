// openprivacy-kr web UI — vanilla ES module, zero external dependencies, text-node only (CSP safe)

const statusNames = {
  gap: '부족',
  conflict: '답변·점검 불일치',
  partial: '부분 충족',
  noEvidence: '증적 부족',
  needsFact: '상황 확인 필요',
  unanswered: '미응답',
  met: '충족',
  na: '해당 없음',
}
const statusOrder = ['gap', 'conflict', 'partial', 'noEvidence', 'needsFact', 'unanswered', 'met', 'na']
const barOrder = ['met', 'noEvidence', 'partial', 'conflict', 'gap', 'needsFact', 'unanswered']
const ismspSubgroups = {
  '1.1': '관리체계 기반 마련',
  '1.2': '위험 관리',
  '1.3': '관리체계 운영',
  '1.4': '관리체계 점검 및 개선',
  '2.1': '정책, 조직, 자산 관리',
  '2.2': '인적 보안',
  '2.3': '외부자 보안',
  '2.4': '물리 보안',
  '2.5': '인증 및 권한관리',
  '2.6': '접근통제',
  '2.7': '암호화 적용',
  '2.8': '정보시스템 도입 및 개발 보안',
  '2.9': '시스템 및 서비스 운영관리',
  '2.10': '시스템 및 서비스 보안관리',
  '2.11': '사고 예방 및 대응',
  '2.12': '재해 복구',
  '3.1': '개인정보 수집 시 보호조치',
  '3.2': '개인정보 보유 및 이용 시 보호조치',
  '3.3': '개인정보 제공 시 보호조치',
  '3.4': '개인정보 파기 시 보호조치',
  '3.5': '정보주체 권리보호',
}
const worstStatus = (list) => statusOrder.find((s) => list.includes(s)) ?? 'unanswered'
function tallyStatuses(list) {
  const out = Object.fromEntries(statusOrder.map((k) => [k, 0]))
  for (const item of list) out[item.status] = (out[item.status] ?? 0) + 1
  return out
}
function pointStatus(pt, byCheck) {
  const linked = pt.checks.map((id) => byCheck.get(id)).filter(Boolean)
  const active = linked.filter((c) => c.status !== 'na')
  if (active.length) return worstStatus(active.map((c) => c.status))
  return linked.length ? 'na' : 'unanswered'
}
const targets = {
  pipa: '개인정보 보호법',
  isms: 'ISMS(80개)',
  ismsp: 'ISMS-P(101개)',
  iso: 'ISO/IEC 27001',
}
const roleNames = {
  check: '점검에 연결',
  always: '항상 확인',
  situational: '상황 발생 시',
  reference: '참고',
}
const tiers = {
  direct: '직접 관련',
  always: '항상 확인',
  related: '함께 볼 조문',
  confirm: '확인 필요',
  rest: '나머지',
}
const evidenceStateNames = {
  valid: '유효',
  expiring: '30일 내 만료',
  expired: '만료',
  missing: '파일 없음',
  modified: '내용 변경됨',
}

const navGroups = [
  { id: 'overview', label: '', items: ['home'] },
  { id: 'diag', label: '진단', items: ['facts', 'checks', 'gaps', 'ismsp'] },
  { id: 'review', label: '검토', items: ['review', 'law'] },
  { id: 'manage', label: '관리', items: ['flows', 'risks', 'evidence'] },
  { id: 'ref', label: '문서·기준', items: ['docs', 'sources'] },
]

const viewMeta = {
  home: { label: '현황', group: '', render: homeView },
  facts: { label: '상황 입력', group: '진단', render: factsView },
  checks: { label: '점검', group: '진단', render: checksView },
  gaps: { label: '부족한 점·개선', group: '진단', render: gapsView },
  ismsp: { label: '인증기준', group: '진단', render: ismspView },
  review: { label: '상황 검토', group: '검토', render: reviewView },
  law: { label: '법령 전문', group: '검토', render: lawView },
  flows: { label: '처리 흐름', group: '관리', render: flowsView },
  risks: { label: '위험', group: '관리', render: risksView },
  evidence: { label: '증적', group: '관리', render: evidenceView },
  docs: { label: '문서', group: '문서·기준', render: docsView },
  sources: { label: '기준', group: '문서·기준', render: sourcesView },
}

// 토큰은 시작 시 location.hash에서 한 번만 읽어 메모리에만 보관합니다.
// 저장소·쿼리 문자열·로그에는 절대 남기지 않습니다.
const { startupToken, startupView } = (() => {
  const raw = location.hash.slice(1)
  if (!raw) return { startupToken: '', startupView: 'home' }
  if (Object.hasOwn(viewMeta, raw)) return { startupToken: '', startupView: raw }
  const slash = raw.indexOf('/')
  if (slash > 0) {
    const maybeView = raw.slice(slash + 1)
    if (Object.hasOwn(viewMeta, maybeView)) {
      return { startupToken: raw.slice(0, slash), startupView: maybeView }
    }
  }
  return { startupToken: raw, startupView: 'home' }
})()
const token = startupToken

let state = null
let law = null
let lawPromise = null
let current = startupView

const gapFilter = { status: '', domain: '', legal: '', fw: '', q: '' }
const checkFilter = { mode: 'all', domain: '', q: '' }
const ismspFilter = { status: '', area: '', q: '' }
const lawFilter = { q: '', source: '', role: '', upcomingOnly: false, annexOnly: false }
const pre = { check: '', risk: null, focusCheck: '' }

const situation = {
  title: '',
  text: '',
  topics: {},
  conclusion: '',
  result: null,
  tierFilter: 'all',
  resultQuery: '',
}
const reviewOpenTiers = new Set(['direct'])
const reviewOpenProvisions = new Set()
let reviewSeq = 0

// DOM landmarks
const shell = document.getElementById('shell')
const sidebar = document.getElementById('sidebar')
const backdrop = document.getElementById('backdrop')
const navEl = document.getElementById('nav')
const orgLabelEl = document.getElementById('org-label')
const sidebarFootEl = document.getElementById('sidebar-foot')
const crumbTextEl = document.getElementById('crumb-text')
const menuOpenBtn = document.getElementById('menu-open')
const menuCloseBtn = document.getElementById('menu-close')
const main = document.getElementById('main')
const saved = document.getElementById('saved')
const alertBar = document.getElementById('alert-bar')

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
const scrollIntoViewSafe = (el) => el.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' })

// 사용자 입력과 법령 문구는 모두 텍스트 노드로만 넣습니다 (innerHTML 금지)
function h(tagName, props = {}, ...kids) {
  const el = document.createElement(tagName)
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v)
    else if (k === 'class') el.className = v
    else if (k === 'value') el.value = v
    else if (k === 'checked') el.checked = Boolean(v)
    else if (k === 'selected') el.selected = Boolean(v)
    else if (k === 'open') el.open = Boolean(v)
    else if (k === 'disabled') el.disabled = Boolean(v)
    else if (k === 'hidden') el.hidden = Boolean(v)
    else el.setAttribute(k, v === true ? '' : String(v))
  }
  el.append(
    ...kids
      .flat(9)
      .filter((k) => k !== null && k !== undefined && k !== false)
      .map((k) => (k instanceof Node ? k : String(k))),
  )
  return el
}

const tag = (cls, text) => h('span', { class: `tag ${cls}` }, text)
const field = (label, input, help) =>
  h('label', { class: 'field' }, h('span', {}, label), input, help ? h('span', { class: 'small muted' }, help) : null)

function table(head, rows, numCols = new Set()) {
  return h(
    'div',
    { class: 'scroll' },
    h(
      'table',
      {},
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          head.map((x, idx) => h('th', { scope: 'col', class: numCols.has(idx) ? 'n' : '' }, x)),
        ),
      ),
      h(
        'tbody',
        {},
        rows.map((r) =>
          h(
            'tr',
            {},
            r.map((c, idx) => h('td', { class: typeof c === 'number' || numCols.has(idx) ? 'n' : '' }, c)),
          ),
        ),
      ),
    ),
  )
}

const select = (value, options, onchange, label) =>
  h(
    'select',
    { onchange: (e) => onchange(e.target.value), 'aria-label': label },
    Object.entries(options).map(([v, t]) => h('option', { value: v, selected: v === value }, t)),
  )

// 텍스트 노드 기반 검색어 강조
function highlightText(text, query) {
  const s = String(text ?? '')
  const q = (query ?? '').trim()
  if (!q) return [s]
  const lower = s.toLowerCase()
  const needle = q.toLowerCase()
  const out = []
  let idx = 0
  while (idx < s.length) {
    const hit = lower.indexOf(needle, idx)
    if (hit === -1) {
      out.push(s.slice(idx))
      break
    }
    if (hit > idx) out.push(s.slice(idx, hit))
    out.push(h('mark', { class: 'hl' }, s.slice(hit, hit + q.length)))
    idx = hit + q.length
  }
  return out
}

function excerptAround(text, query, radius = 56) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim()
  const q = (query ?? '').trim()
  if (!s || !q) return null
  const pos = s.toLowerCase().indexOf(q.toLowerCase())
  if (pos === -1) return null
  const start = Math.max(0, pos - radius)
  const end = Math.min(s.length, pos + q.length + radius)
  const slice = `${start > 0 ? '…' : ''}${s.slice(start, end)}${end < s.length ? '…' : ''}`
  return highlightText(slice, q)
}

// API & 직렬화된 저장 큐 (유실 방지)
async function api(path, init = {}) {
  const r = await fetch(path, {
    ...init,
    headers: { 'x-openprivacy-token': token, 'content-type': 'application/json' },
  })
  if (!r.ok) {
    let msg = `요청 오류 (${r.status})`
    try {
      const data = await r.json()
      if (data?.error) msg = data.error
    } catch {
      // keep fallback message
    }
    throw new Error(msg)
  }
  return r
}

function showAlert(msg) {
  alertBar.hidden = false
  alertBar.replaceChildren(
    h('span', {}, msg),
    h(
      'button',
      {
        type: 'button',
        class: 'compact ghost',
        onclick: () => {
          clearAlert()
          if (saved.className === 'err') {
            saved.className = ''
            saved.textContent = ''
          }
        },
      },
      '닫기',
    ),
  )
}

function clearAlert() {
  alertBar.hidden = true
  alertBar.replaceChildren()
}

function fail(e) {
  const msg = e instanceof Error ? e.message : String(e)
  saved.className = 'err'
  saved.textContent = msg
  showAlert(msg)
}

let queue = Promise.resolve()
let pending = 0
/** 저장 요청을 차례로 보내 늦게 도착한 응답이 새 값을 덮지 않게 합니다. */
function save(name, value, rerender = false, onSaved) {
  saved.className = ''
  saved.textContent = '저장 중…'
  const payload = JSON.stringify(value)
  state.data = { ...state.data, [name]: value }
  pending++
  queue = queue.then(async () => {
    try {
      const fresh = await (await api(`/api/data/${name}`, { method: 'PUT', body: payload })).json()
      // 아직 보내지 않은 입력이 있으면 화면의 값이 서버보다 새것입니다
      if (--pending > 0) fresh.data = state.data
      state = fresh
      if (!pending) {
        saved.className = ''
        saved.textContent = '저장됨'
        clearAlert()
        updateChrome()
      }
      if (onSaved) onSaved(state)
      if (rerender) draw()
    } catch (e) {
      pending = Math.max(0, pending - 1)
      fail(e)
      try {
        state = await (await api('/api/state')).json()
        updateChrome()
        draw()
      } catch {
        // 401/네트워크 오류 시 기존 오류 메시지 유지
      }
    }
  })
  return queue
}

const draft = (name) => structuredClone(state.data[name])
const isOpen = (c) => !['met', 'na', 'unanswered', 'needsFact'].includes(c.status)

async function needLaw() {
  if (law) return law
  if (!lawPromise) {
    lawPromise = api('/api/law')
      .then((r) => r.json())
      .then((data) => {
        data.byId = new Map(data.provisions.map((p) => [p.id, p]))
        law = data
        return law
      })
      .catch((e) => {
        lawPromise = null
        throw e
      })
  }
  return lawPromise
}

// Navigation & Drawer
function setNavOpen(open) {
  shell.classList.toggle('nav-open', open)
  backdrop.hidden = !open
  menuOpenBtn.setAttribute('aria-expanded', open ? 'true' : 'false')
  if (open) menuCloseBtn.focus()
}

menuOpenBtn.addEventListener('click', () => setNavOpen(true))
menuCloseBtn.addEventListener('click', () => {
  setNavOpen(false)
  menuOpenBtn.focus()
})
backdrop.addEventListener('click', () => {
  setNavOpen(false)
  menuOpenBtn.focus()
})
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && shell.classList.contains('nav-open')) {
    setNavOpen(false)
    menuOpenBtn.focus()
  }
})

function navBadges() {
  if (!state) return {}
  const a = state.assessment
  const openGaps = a.checks.filter(isOpen)
  const hasBadGap = openGaps.some((c) => c.status === 'gap' || c.status === 'conflict')
  const badEvidence = state.data.evidence.filter((e) => {
    const s = state.evidenceStates[e.id]?.state
    return s === 'expired' || s === 'missing' || s === 'modified'
  }).length
  return {
    gaps: openGaps.length ? { n: openGaps.length, cls: hasBadGap ? 'is-bad' : 'is-warn' } : null,
    flows: a.flowIssues.length ? { n: a.flowIssues.length, cls: 'is-warn' } : null,
    evidence: badEvidence ? { n: badEvidence, cls: 'is-bad' } : null,
  }
}

const navRefs = new Map()
function initNav() {
  if (navRefs.size) return
  navEl.replaceChildren(
    ...navGroups.map((g) =>
      h(
        'div',
        { class: 'nav-group' },
        g.label ? h('div', { class: 'nav-group-label', id: `ng-${g.id}` }, g.label) : null,
        h(
          'ul',
          { class: 'nav-list', role: 'list', 'aria-labelledby': g.label ? `ng-${g.id}` : undefined },
          g.items.map((id) => {
            const countEl = h('span', { class: 'nav-count', hidden: true })
            const btn = h(
              'button',
              {
                type: 'button',
                class: 'nav-item',
                'data-view': id,
                onclick: () => go(id),
              },
              h('span', { class: 'nav-label' }, viewMeta[id].label),
              countEl,
            )
            const li = h('li', {}, btn)
            navRefs.set(id, { li, btn, countEl })
            return li
          }),
        ),
      ),
    ),
  )
}

function updateChrome() {
  if (!state) return
  initNav()
  const org = state.data.profile.facts.orgName || '우리 조직'
  orgLabelEl.textContent = org
  sidebarFootEl.textContent = `준비도 ${state.assessment.readiness}% · ${state.today}`
  const meta = viewMeta[current]
  crumbTextEl.textContent = meta.group ? `${meta.group} / ${meta.label}` : meta.label
  document.title = `${meta.label} — openprivacy-kr`

  const hasIsms = state.data.profile.targets.includes('isms') || state.data.profile.targets.includes('ismsp')
  const badges = navBadges()
  for (const [id, { li, btn, countEl }] of navRefs) {
    if (id === 'ismsp') li.hidden = !hasIsms
    if (id === current) btn.setAttribute('aria-current', 'page')
    else btn.removeAttribute('aria-current')
    const b = badges[id]
    if (b) {
      countEl.hidden = false
      countEl.className = `nav-count ${b.cls}`
      countEl.setAttribute('aria-label', `${b.n}건`)
      countEl.textContent = String(b.n)
    } else {
      countEl.hidden = true
      countEl.textContent = ''
      countEl.removeAttribute('aria-label')
    }
  }
}

function draw() {
  if (!state) return
  updateChrome()
  main.replaceChildren(...[viewMeta[current].render()].flat(9).filter(Boolean))
}

function go(id, { push = true } = {}) {
  if (!Object.hasOwn(viewMeta, id)) return
  if (shell.classList.contains('nav-open')) setNavOpen(false)
  current = id
  if (push && location.hash !== `#${id}`) {
    history.pushState(null, '', `#${id}`)
  }
  draw()
  scrollTo(0, 0)
  main.focus({ preventScroll: true })
}

function syncFromHash() {
  if (!state) return
  const id = location.hash.slice(1)
  if (Object.hasOwn(viewMeta, id) && id !== current) {
    go(id, { push: false })
  }
}
window.addEventListener('hashchange', syncFromHash)
window.addEventListener('popstate', syncFromHash)

// 공통 시각화·법령 헬퍼
function bar(counts) {
  const total = barOrder.reduce((n, k) => n + counts[k], 0) || 1
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('class', 'bar')
  svg.setAttribute('viewBox', '0 0 100 8')
  svg.setAttribute('preserveAspectRatio', 'none')
  svg.setAttribute('role', 'img')
  svg.setAttribute(
    'aria-label',
    barOrder
      .filter((k) => counts[k])
      .map((k) => `${statusNames[k]} ${counts[k]}`)
      .join(', '),
  )
  let x = 0
  for (const k of barOrder) {
    if (!counts[k]) continue
    const r = document.createElementNS(ns, 'rect')
    const w = (counts[k] / total) * 100
    r.setAttribute('x', x)
    r.setAttribute('width', w)
    r.setAttribute('height', 8)
    r.setAttribute('class', `f-${k}`)
    svg.append(r)
    x += w
  }
  return svg
}

const refs = (c) =>
  [
    c.frameworks.includes('pipa') && c.check.map.pipa.join(', '),
    c.frameworks.includes('ismsp') && c.check.map.ismsp.length && `ISMS-P ${c.check.map.ismsp.join(', ')}`,
    c.frameworks.includes('iso') && c.check.map.iso.length && `ISO ${c.check.map.iso.join(', ')}`,
  ]
    .filter(Boolean)
    .join(' / ')

const sanctionList = (list) => [
  h('p', { class: 'small muted' }, '조문 단위로 연결한 참고 정보입니다. 해당 여부는 각 호의 요건을 확인하세요.'),
  ...list.map((s) =>
    h(
      'p',
      { class: 'small' },
      h('strong', {}, `${s.article} ${s.item} `),
      s.text.replace(/^\S+\. /, ''),
      h('span', { class: 'muted' }, ` — ${s.lead.slice(0, 140)}${s.lead.length > 140 ? '…' : ''}`),
    ),
  ),
]

function lawIdText(p) {
  if (p.kind === 'addendum') return p.id
  return `${p.source === 'law' ? '법 ' : ''}${p.id}`
}

function lawName(p) {
  if (p.kind === 'addendum') return p.id
  return `${p.source === 'law' ? '법 ' : ''}${p.id} ${p.title}${p.text ? '' : ' (시행 예정)'}`
}

function jumpToCheck(checkId) {
  checkFilter.mode = 'all'
  checkFilter.domain = ''
  checkFilter.q = ''
  pre.focusCheck = checkId
  go('checks')
}

function provisionEl(p, opts = {}) {
  const { reasons = null, query = '', defaultOpen = false, onToggle = null } = opts
  const idStr = lawIdText(p)
  const upcomingTag = !p.text && p.upcoming
    ? tag('s-upcoming', `신설 예정 ${p.upcoming.effective}`)
    : !p.text
      ? tag('s-upcoming', '시행 예정')
      : p.upcoming
        ? tag('s-upcoming', `개정 예정 ${p.upcoming.effective}`)
        : null
  const pendingTag = p.pending ? tag('s-upcoming', '시행 주의') : null
  const annexTag = p.kind === 'annex' ? tag('s-na', '별표') : null

  const snippet = query
    ? excerptAround(p.text || '', query) || excerptAround(p.upcoming?.text || '', query)
    : null

  const d = h(
    'details',
    { class: 'law', 'data-law-id': p.id, open: defaultOpen },
    h(
      'summary',
      { class: 'law-sum' },
      h(
        'div',
        { class: 'law-sum-top' },
        h('span', { class: 'law-id' }, highlightText(idStr, query)),
        p.kind !== 'addendum' ? h('span', { class: 'law-title' }, highlightText(p.title, query)) : null,
        upcomingTag,
        pendingTag,
        annexTag,
      ),
      h(
        'div',
        { class: 'law-reason' },
        reasons ? reasons.join(', ') : `${roleNames[p.role]} · ${p.why}`,
      ),
      snippet ? h('div', { class: 'law-snippet' }, snippet) : null,
    ),
  )

  const populate = () => {
    if (d.dataset.ready) return
    d.dataset.ready = '1'
    const byCheck = new Map(state.assessment.checks.map((c) => [c.check.id, c]))
    const linked = p.checks.length
      ? h(
          'div',
          {},
          h('div', { class: 'law-subhead' }, `연결된 점검 (${p.checks.length})`),
          h(
            'div',
            { class: 'linked-checks' },
            p.checks.map((cid) => {
              const cr = byCheck.get(cid)
              if (!cr) {
                return h(
                  'div',
                  { class: 'linked-check-row' },
                  h('span', { class: 'muted small' }, `${cid} (현재 선택한 기준 외)`),
                )
              }
              return h(
                'div',
                { class: 'linked-check-row' },
                h(
                  'div',
                  { class: 'linked-check-main' },
                  h('div', { class: 'row' }, tag(`s-${cr.status}`, statusNames[cr.status]), h('span', { class: 'mono small muted' }, cid)),
                  h('div', {}, cr.required),
                ),
                h(
                  'button',
                  { type: 'button', class: 'compact', onclick: () => jumpToCheck(cid) },
                  '점검 보기',
                ),
              )
            }),
          ),
        )
      : null

    const body = h(
      'div',
      { class: 'law-body' },
      p.pending ? h('div', { class: 'notice is-warn small' }, `시행 시점 주의: ${p.pending}`) : null,
      p.text
        ? p.kind === 'annex'
          ? h('div', { class: 'annex-box' }, h('pre', { class: 'law-text annex' }, highlightText(p.text, query)))
          : h('pre', { class: 'law-text' }, highlightText(p.text, query))
        : null,
      p.upcoming
        ? h(
            'div',
            { class: 'upcoming-box' },
            h('div', { class: 'law-subhead' }, `시행 예정 (${p.upcoming.effective})`),
            h('pre', { class: 'law-text' }, highlightText(p.upcoming.text, query)),
          )
        : null,
      p.implementedBy.length
        ? h(
            'div',
            {},
            h('div', { class: 'law-subhead' }, `세부 규정 (${p.implementedBy.length})`),
            p.implementedBy.map((id) => {
              const sub = law.byId.get(id)
              return sub ? provisionEl(sub, { query }) : null
            }),
          )
        : null,
      p.sanctions.length
        ? h('div', {}, h('div', { class: 'law-subhead' }, `제재 참고 (${p.sanctions.length})`), sanctionList(p.sanctions))
        : null,
      linked,
    )
    d.append(body)
  }

  if (defaultOpen) populate()
  d.addEventListener('toggle', () => {
    if (d.open) populate()
    if (onToggle) onToggle(d.open)
  })
  return d
}

// Compact expandable gap row (used in home & gaps triage)
function gapRow(c, defaultOpen = false) {
  const ans = state.data.answers[c.check.id]
  return h(
    'details',
    { class: 'gap-row', open: defaultOpen, 'data-check-id': c.check.id },
    h(
      'summary',
      { class: 'gap-summary' },
      h(
        'div',
        { class: 'gap-summary-main' },
        h(
          'div',
          { class: 'gap-summary-meta' },
          tag(`p-${c.priorityName}`, c.priorityName),
          tag(`s-${c.status}`, statusNames[c.status]),
          c.legal ? tag('s-required', '법적 의무') : null,
          c.stale ? tag('s-stale', '1년 넘음 · 재확인 필요') : null,
          h('span', { class: 'small muted' }, c.check.domain),
          c.answeredAt ? h('span', { class: 'small muted check-date' }, `· 판단일 ${c.answeredAt}`) : null,
          c.sanctions.length ? h('span', { class: 'small muted' }, `· 제재 ${c.sanctions.length}건`) : null,
          c.findings.length ? tag('s-conflict', `기술 점검 실패 ${c.findings.length}건`) : null,
          ans?.owner || ans?.due
            ? h('span', { class: 'small muted' }, `· ${[ans.owner, ans.due].filter(Boolean).join(' ')}`)
            : null,
        ),
        h('div', { class: 'gap-summary-title' }, c.required),
        h('div', { class: 'small muted' }, `현재: ${c.current} — ${c.reason}`),
      ),
      h('span', { class: 'gap-chevron', 'aria-hidden': 'true' }),
    ),
    h(
      'div',
      { class: 'gap-body' },
      h(
        'dl',
        { class: 'gap-dl' },
        h('dt', {}, '현재'),
        h('dd', {}, c.current),
        c.answeredAt
          ? [
              h('dt', {}, '판단일'),
              h(
                'dd',
                { class: 'row' },
                h('span', { class: 'check-date' }, c.answeredAt),
                c.stale ? tag('s-stale', '1년 넘음 · 재확인 필요') : null,
              ),
            ]
          : null,
        h('dt', {}, '부족한 점'),
        h('dd', {}, c.reason),
        h('dt', {}, '개선 방법'),
        h('dd', {}, h('ol', {}, c.check.fix.map((f) => h('li', {}, f)))),
        h('dt', {}, '준비할 증적'),
        h('dd', {}, c.check.evidence.join(', ')),
        h('dt', {}, '관련 기준'),
        h('dd', {}, refs(c) || '-'),
        c.sanctions.length
          ? [
              h('dt', {}, '제재 참고'),
              h(
                'dd',
                {},
                h(
                  'details',
                  { class: 'sub-disclosure' },
                  h('summary', {}, c.sanctions.map((s) => `법 ${s.article} ${s.item}`).join(', ')),
                  sanctionList(c.sanctions),
                ),
              ),
            ]
          : null,
        c.findings.length
          ? [
              h('dt', {}, '기술 점검'),
              h(
                'dd',
                {},
                c.findings.map((f) =>
                  h('div', { class: 'finding-line' }, `${f.title} (${f.scanner} · ${f.target}) ${f.detail}`),
                ),
              ),
            ]
          : null,
        ans?.owner || ans?.due
          ? [h('dt', {}, '담당·기한'), h('dd', {}, [ans.owner, ans.due].filter(Boolean).join(' · '))]
          : null,
      ),
      h(
        'div',
        { class: 'row' },
        h(
          'button',
          {
            type: 'button',
            class: 'compact',
            onclick: () => {
              pre.check = c.check.id
              go('evidence')
            },
          },
          '증적 추가',
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'compact',
            onclick: () => {
              pre.risk = c
              go('risks')
            },
          },
          '위험으로 등록',
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'compact',
            onclick: () => jumpToCheck(c.check.id),
          },
          '점검에서 답변 수정',
        ),
      ),
    ),
  )
}

// =========================================================================
// 1. 현황 (home)
// =========================================================================
function homeView() {
  const a = state.assessment
  const openList = a.checks.filter(isOpen)
  const top = openList.slice(0, 5)
  const filled = Object.keys(state.data.profile.facts).length
  const totalFacts = state.catalog.factGroups.reduce((n, g) => n + g.facts.length, 0)
  const judged = a.checks.length - a.counts.unanswered - a.counts.needsFact
  const labels = { required: '해당', verify: '확인 필요' }
  const badEvidence = state.data.evidence.filter((e) => {
    const s = state.evidenceStates[e.id]?.state
    return s === 'expired' || s === 'missing' || s === 'modified'
  })
  const staleList = a.checks.filter((c) => c.stale)

  return [
    h(
      'div',
      { class: 'page-head' },
      h(
        'div',
        { class: 'page-head-main' },
        h('h1', {}, state.data.profile.facts.orgName || '우리 조직', '의 준비 현황'),
        h('p', { class: 'muted' }, `상황 ${filled}/${totalFacts}개 입력 · 점검 ${judged}/${a.checks.length}개 판단`),
      ),
      h(
        'div',
        { class: 'row' },
        h('button', { type: 'button', class: 'primary', onclick: () => go('review') }, '상황 검토'),
        h('button', { type: 'button', onclick: () => go(filled ? 'checks' : 'facts') }, filled ? '점검 이어서 하기' : '상황 입력'),
      ),
    ),
    a.counts.conflict > 0
      ? h(
          'div',
          { class: 'notice is-bad row between' },
          h('span', {}, `답변·점검 불일치 ${a.counts.conflict}건이 있습니다. 충족으로 답했지만 기술 점검에서 실패가 확인된 항목을 먼저 점검하세요.`),
          h(
            'button',
            {
              type: 'button',
              class: 'compact',
              onclick: () => {
                gapFilter.status = 'conflict'
                go('gaps')
              },
            },
            '불일치 항목 보기',
          ),
        )
      : null,
    staleList.length > 0
      ? h(
          'div',
          { class: 'notice is-warn row between', 'data-stale-banner': '1' },
          h(
            'span',
            {},
            `1년 넘게 재확인하지 않은 답변 ${staleList.length}건이 있습니다. 인증 사후·갱신심사는 매년 있으므로 현재 상태를 다시 확인하세요.`,
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'compact',
              onclick: () => {
                checkFilter.mode = 'stale'
                checkFilter.domain = ''
                checkFilter.q = ''
                go('checks')
              },
            },
            `재확인 필요 ${staleList.length}건 보기`,
          ),
        )
      : null,
    h(
      'section',
      { class: 'panel summary' },
      h(
        'div',
        { class: 'summary-kpi' },
        h('div', { class: 'big' }, `${a.readiness}%`),
        h('div', { class: 'muted small' }, '충족하고 유효한 증적까지 있는 항목 비율'),
        h(
          'div',
          { class: 'legend-list' },
          h('span', { class: 'legend-item' }, h('span', { class: 'dot d-met' }), `충족 ${a.counts.met}`),
          h('span', { class: 'legend-item' }, h('span', { class: 'dot d-noEvidence' }), `증적 부족 ${a.counts.noEvidence}`),
          h('span', { class: 'legend-item' }, h('span', { class: 'dot d-partial' }), `부분 ${a.counts.partial}`),
          h('span', { class: 'legend-item' }, h('span', { class: 'dot d-gap' }), `부족·불일치 ${a.counts.gap + a.counts.conflict}`),
          h('span', { class: 'legend-item' }, h('span', { class: 'dot d-unanswered' }), `미판단 ${a.counts.unanswered + a.counts.needsFact}`),
        ),
      ),
      table(
        ['기준', '현황', '충족', '증적 부족', '부족·부분', '미판단'],
        a.frameworks.map((f) => [
          f.title,
          bar(f.counts),
          `${f.counts.met}/${f.applicable}`,
          f.counts.noEvidence,
          f.counts.gap + f.counts.conflict + f.counts.partial,
          f.counts.unanswered + f.counts.needsFact,
        ]),
        new Set([2, 3, 4, 5]),
      ),
    ),
    h(
      'div',
      { class: 'section-bar' },
      h('h2', {}, `먼저 고칠 것${openList.length ? ` (상위 ${top.length}/${openList.length}건)` : ''}`),
      openList.length > top.length
        ? h('button', { type: 'button', class: 'compact', onclick: () => go('gaps') }, `전체 ${openList.length}건 보기`)
        : null,
    ),
    top.length
      ? h('section', { class: 'panel panel-tight' }, top.map((c) => gapRow(c, false)))
      : h(
          'div',
          { class: 'notice row between' },
          h('span', {}, '아직 확인된 부족한 점이 없습니다. 상황을 입력하고 점검에 답하면 여기에 표시됩니다.'),
          h(
            'button',
            { type: 'button', class: 'primary compact', onclick: () => go(filled ? 'checks' : 'facts') },
            filled ? '점검에 답하기' : '상황 입력하기',
          ),
        ),
    a.flowIssues.length || badEvidence.length
      ? h(
          'div',
          { class: 'row' },
          a.flowIssues.length
            ? h('button', { type: 'button', onclick: () => go('flows') }, `처리 흐름에서 문제 ${a.flowIssues.length}건`)
            : null,
          badEvidence.length
            ? h('button', { type: 'button', onclick: () => go('evidence') }, `확인 필요한 증적 ${badEvidence.length}건`)
            : null,
        )
      : null,
    h('h2', {}, '우리 조직에 적용되는 의무'),
    h(
      'section',
      { class: 'panel panel-tight' },
      table(
        ['판정', '의무', '내용', '근거'],
        a.obligations
          .filter((o) => o.status !== 'notRequired')
          .map((o) => [tag(`s-${o.status}`, labels[o.status]), o.title, o.text, o.basis]),
      ),
    ),
    h(
      'div',
      { class: 'disclaimer-stack' },
      h(
        'p',
        { class: 'muted small' },
        '개인정보 보호법 현황은 점검으로 확인하는 의무 조문만 셉니다. 100%여도 법 전체 준수를 뜻하지 않으며, 개별 사안은 상황 검토에서 전체 조문을 확인하세요.',
      ),
      h('p', { class: 'muted small' }, '자가진단 결과이며 법률 자문이나 인증 심사를 대신하지 않습니다.'),
    ),
  ]
}

// =========================================================================
// 2. 상황 입력 (facts)
// =========================================================================
function factsView() {
  const p = draft('profile')
  const countEls = new Map()
  const updateCounts = () => {
    for (const g of state.catalog.factGroups) {
      const n = g.facts.filter((f) => p.facts[f.id] !== undefined).length
      const el = countEls.get(g.title)
      if (el) el.textContent = `${g.title} ${n}/${g.facts.length}`
    }
  }
  const set = (id, v) => {
    if (v === undefined || v === '') delete p.facts[id]
    else p.facts[id] = v
    updateCounts()
    save('profile', p)
  }
  const input = (f) => {
    const v = p.facts[f.id]
    if (f.type === 'bool') {
      return select(
        v === undefined ? '' : String(v),
        { '': '모름', true: '예', false: '아니오' },
        (x) => set(f.id, x === '' ? undefined : x === 'true'),
        f.label,
      )
    }
    if (f.type === 'choice') {
      return select(v ?? '', { '': '선택', ...f.options }, (x) => set(f.id, x), f.label)
    }
    if (f.type === 'number') {
      return h('input', {
        type: 'number',
        min: 0,
        step: 'any',
        value: v ?? '',
        onchange: (e) => set(f.id, e.target.value === '' ? undefined : Number(e.target.value)),
      })
    }
    return h('input', { value: v ?? '', onchange: (e) => set(f.id, e.target.value.trim()) })
  }

  return [
    h(
      'div',
      { class: 'page-head' },
      h(
        'div',
        { class: 'page-head-main' },
        h('h1', {}, '우리 조직의 상황'),
        h('p', { class: 'muted' }, '모르는 값은 비워 두세요. 모름을 아니오로 처리하지 않고, 판단에 필요한 값으로 따로 알려 줍니다.'),
      ),
      h('button', { type: 'button', class: 'primary', onclick: () => queue.then(() => go('checks')) }, '점검으로 이동'),
    ),
    h(
      'section',
      { class: 'panel' },
      h('h3', {}, '준비할 기준'),
      h(
        'div',
        { class: 'row' },
        Object.entries(targets).map(([id, label]) =>
          h(
            'label',
            { class: 'check-opt' },
            h('input', {
              type: 'checkbox',
              checked: p.targets.includes(id),
              onchange: (e) => {
                const next = e.target.checked ? [...p.targets, id] : p.targets.filter((t) => t !== id)
                if (!next.length) {
                  e.target.checked = true
                  return fail(new Error('기준을 하나 이상 고르세요'))
                }
                p.targets = next
                save('profile', p)
              },
            }),
            label,
          ),
        ),
      ),
    ),
    h(
      'div',
      { class: 'facts-toc', 'aria-label': '상황 분류 바로가기' },
      state.catalog.factGroups.map((g, idx) => {
        const n = g.facts.filter((f) => p.facts[f.id] !== undefined).length
        const link = h(
          'a',
          {
            href: `#facts-g-${idx}`,
            onclick: (e) => {
              e.preventDefault()
              const target = document.getElementById(`facts-g-${idx}`)
              if (target) scrollIntoViewSafe(target)
            },
          },
          `${g.title} ${n}/${g.facts.length}`,
        )
        countEls.set(g.title, link)
        return link
      }),
    ),
    ...state.catalog.factGroups.flatMap((g, idx) => [
      h('h2', { id: `facts-g-${idx}` }, g.title),
      h('section', { class: 'panel grid' }, g.facts.map((f) => field(f.unit ? `${f.label} (${f.unit})` : f.label, input(f), f.help))),
    ]),
    h('div', { class: 'row' }, h('button', { type: 'button', class: 'primary', onclick: () => queue.then(() => go('checks')) }, '점검으로 이동')),
  ]
}

// =========================================================================
// 3. 점검 (checks)
// =========================================================================
function checksView() {
  const focusId = pre.focusCheck
  pre.focusCheck = ''

  const scopedOf = (a) =>
    a.checks.filter((c) => c.status !== 'na' || state.data.answers[c.check.id]?.value === 'na' || c.stale || c.check.id === focusId)
  const allScoped = scopedOf(state.assessment)
  const domains = [...new Set(allScoped.map((c) => c.check.domain))].sort()
  if (checkFilter.domain && !domains.includes(checkFilter.domain)) checkFilter.domain = ''

  const listWrap = h('div', {})
  const domainMetaEls = new Map()
  const rowRefs = new Map()
  const domainPanels = []
  const modeBtnRefs = new Map()

  const computeModeCounts = () => {
    const cur = scopedOf(state.assessment)
    return {
      all: cur.length,
      unanswered: cur.filter((c) => state.data.answers[c.check.id]?.value === undefined).length,
      open: cur.filter(isOpen).length,
      stale: cur.filter((c) => c.stale).length,
    }
  }

  const updateModeBar = () => {
    const counts = computeModeCounts()
    const labels = {
      all: `전체 (${counts.all})`,
      unanswered: `미응답만 (${counts.unanswered})`,
      open: `부족·개선 필요 (${counts.open})`,
      stale: `재확인 필요 (${counts.stale})`,
    }
    for (const [id, btn] of modeBtnRefs) {
      btn.textContent = labels[id]
      btn.setAttribute('aria-pressed', checkFilter.mode === id ? 'true' : 'false')
      if (id === 'stale') btn.hidden = counts.stale === 0 && checkFilter.mode !== 'stale'
    }
  }

  const refreshRowStatuses = () => {
    const byId = new Map(state.assessment.checks.map((c) => [c.check.id, c]))
    for (const [cid, ref] of rowRefs) {
      const fresh = byId.get(cid)
      if (!fresh) continue
      ref.statusTag.className = `tag s-${fresh.status}`
      ref.statusTag.textContent = statusNames[fresh.status]
      ref.dateEl.hidden = !fresh.answeredAt
      ref.dateEl.textContent = fresh.answeredAt ? `판단일 ${fresh.answeredAt}` : ''
      ref.staleEl.hidden = !fresh.stale
    }
    for (const [, meta] of domainMetaEls) {
      const done = meta.ids.filter((id) => state.data.answers[id]?.value !== undefined).length
      meta.countEl.textContent = `${done}/${meta.ids.length} 응답`
      const staleN = meta.ids.filter((id) => byId.get(id)?.stale).length
      meta.staleBadgeEl.hidden = staleN === 0
      meta.staleBadgeEl.textContent = staleN ? `재확인 ${staleN}` : ''
    }
    updateModeBar()
  }

  function answerRow(c) {
    const freshCheck = () => state.assessment.checks.find((x) => x.check.id === c.check.id) ?? c
    const cur = freshCheck()
    const ans = () => state.data.answers[c.check.id] ?? { note: '', owner: '', due: '' }
    const put = (patch) => {
      const next = { ...ans(), ...patch }
      if (next.value === undefined) delete next.value
      save('answers', { ...state.data.answers, [c.check.id]: next }, false, refreshRowStatuses)
    }
    const a = ans()
    const opts = [
      ['yes', '예'],
      ['partial', '일부'],
      ['no', '아니오'],
      ['na', '제외'],
    ]
    const statusTag = tag(`s-${cur.status}`, statusNames[cur.status])
    const dateEl = h('span', { class: 'check-date', hidden: !cur.answeredAt }, cur.answeredAt ? `판단일 ${cur.answeredAt}` : '')
    const staleEl = h('span', { class: 'tag s-stale', hidden: !cur.stale }, '1년 넘음 · 재확인 필요')
    rowRefs.set(c.check.id, { statusTag, dateEl, staleEl })

    const control =
      c.check.type === 'number'
        ? h(
            'div',
            { class: 'row' },
            h('input', {
              class: 'num-input',
              type: 'number',
              min: 0,
              value: typeof a.value === 'number' ? a.value : '',
              'aria-label': c.check.need,
              onchange: (e) => put({ value: e.target.value === '' ? undefined : Number(e.target.value) }),
            }),
            h('span', { class: 'small muted' }, c.check.unit),
          )
        : h(
            'div',
            { class: 'choices', role: 'radiogroup', 'aria-label': c.check.need },
            opts.map(([v, t]) =>
              h(
                'label',
                {},
                h('input', {
                  type: 'radio',
                  name: c.check.id,
                  value: v,
                  checked: a.value === v,
                  onchange: () => put({ value: v }),
                }),
                t,
              ),
            ),
          )

    return h(
      'div',
      { class: `check${focusId === c.check.id ? ' is-focused' : ''}`, 'data-check-id': c.check.id },
      h(
        'div',
        {},
        h('h3', {}, c.check.need),
        h(
          'div',
          { class: 'row small muted' },
          statusTag,
          cur.legal ? tag('s-required', '법적 의무') : null,
          staleEl,
          dateEl,
          h('span', { class: 'mono' }, c.check.id),
          refs(cur) ? h('span', {}, refs(cur)) : null,
          cur.status === 'needsFact' || (focusId === c.check.id && cur.status === 'na') ? h('span', {}, cur.reason) : null,
        ),
        cur.findings.length
          ? h(
              'div',
              { class: 'finding-line' },
              cur.findings.map((f) => `${f.title} (${f.scanner} · ${f.target}) ${f.detail}`).join(' / '),
            )
          : null,
      ),
      control,
      h(
        'details',
        { class: 'wide sub-disclosure small' },
        h('summary', {}, a.note || a.owner || a.due ? '메모·담당자·기한 보기' : '메모·담당자·기한 추가'),
        h(
          'div',
          { class: 'grid' },
          field(
            '현재 상황 메모 (제외할 때는 사유 필수)',
            h('textarea', { value: a.note, onchange: (e) => put({ note: e.target.value.trim() }) }),
          ),
          field('담당자', h('input', { value: a.owner, onchange: (e) => put({ owner: e.target.value.trim() }) })),
          field('개선 기한', h('input', { type: 'date', value: a.due, onchange: (e) => put({ due: e.target.value }) })),
        ),
      ),
    )
  }

  const resetBtn = h(
    'button',
    {
      type: 'button',
      class: 'compact ghost',
      hidden: true,
      onclick: () => {
        Object.assign(checkFilter, { mode: 'all', domain: '', q: '' })
        searchInput.value = ''
        domainSelect.value = ''
        updateModeBar()
        renderDomains()
      },
    },
    '필터 초기화',
  )
  const domainSelect = select(
    checkFilter.domain,
    {
      '': `모든 영역 (${allScoped.length})`,
      ...Object.fromEntries(domains.map((d) => [d, `${d} (${allScoped.filter((c) => c.check.domain === d).length})`])),
    },
    (v) => {
      checkFilter.domain = v
      renderDomains()
    },
    '영역',
  )
  const searchInput = h('input', {
    type: 'search',
    'aria-label': '점검 항목 검색',
    placeholder: '항목 ID, 요구사항, 조문·기준 번호로 찾기',
    value: checkFilter.q,
    oninput: (e) => {
      checkFilter.q = e.target.value
      renderDomains()
    },
  })
  const shownCountEl = h('span', { class: 'small muted num' }, '')

  const renderDomains = () => {
    domainMetaEls.clear()
    rowRefs.clear()
    domainPanels.length = 0
    const curScoped = scopedOf(state.assessment)
    const q = checkFilter.q.trim().toLowerCase()
    const matches = (c) => {
      if (checkFilter.domain && c.check.domain !== checkFilter.domain) return false
      if (checkFilter.mode === 'unanswered' && state.data.answers[c.check.id]?.value !== undefined) return false
      if (checkFilter.mode === 'open' && !isOpen(c)) return false
      if (checkFilter.mode === 'stale' && !c.stale) return false
      if (q) {
        const note = state.data.answers[c.check.id]?.note ?? ''
        if (!`${c.check.id} ${c.check.need} ${c.check.domain} ${refs(c)} ${c.reason} ${note}`.toLowerCase().includes(q)) return false
      }
      return true
    }

    const blocks = []
    let shownTotal = 0
    for (const d of domains) {
      const list = curScoped
        .filter((c) => c.check.domain === d && matches(c))
        .sort((x, y) => x.check.id.localeCompare(y.check.id))
      if (!list.length) continue
      shownTotal += list.length
      const done = list.filter((c) => state.data.answers[c.check.id]?.value !== undefined).length
      const staleN = list.filter((c) => c.stale).length
      const hasFocus = list.some((c) => c.check.id === focusId)
      const countEl = h('span', { class: 'small muted num' }, `${done}/${list.length} 응답`)
      const staleBadgeEl = h('span', { class: 'tag s-stale num', hidden: staleN === 0 }, staleN ? `재확인 ${staleN}` : '')
      domainMetaEls.set(d, { countEl, staleBadgeEl, ids: list.map((c) => c.check.id) })
      const bodyHost = h('div', {})
      const defaultOpen = domains.length === 1 || hasFocus || checkFilter.mode !== 'all' || Boolean(checkFilter.domain) || Boolean(q)
      const det = h(
        'details',
        { class: 'panel', open: defaultOpen },
        h('summary', { class: 'disclosure-head' }, h('span', { class: 'row' }, h('strong', {}, d), countEl, staleBadgeEl)),
        bodyHost,
      )
      const populate = () => {
        if (bodyHost.dataset.ready) return
        bodyHost.dataset.ready = '1'
        bodyHost.replaceChildren(...list.map(answerRow))
      }
      if (defaultOpen) populate()
      det.addEventListener('toggle', () => {
        if (det.open) populate()
      })
      domainPanels.push({ det, populate })
      blocks.push(det)
    }

    shownCountEl.textContent = `${shownTotal}/${curScoped.length}항목`
    resetBtn.hidden = !(checkFilter.mode !== 'all' || checkFilter.domain || q)
    listWrap.replaceChildren(
      ...(blocks.length ? blocks : [h('p', { class: 'notice' }, '조건에 맞는 점검 항목이 없습니다.')]),
    )
  }

  const modeBar = h(
    'div',
    { class: 'chip-row', role: 'group', 'aria-label': '점검 필터' },
    ['all', 'unanswered', 'open', 'stale'].map((id) => {
      const btn = h(
        'button',
        {
          type: 'button',
          class: 'chip-btn',
          'data-check-mode': id,
          'aria-pressed': checkFilter.mode === id ? 'true' : 'false',
          onclick: () => {
            checkFilter.mode = id
            updateModeBar()
            renderDomains()
          },
        },
        '',
      )
      modeBtnRefs.set(id, btn)
      return btn
    }),
  )
  updateModeBar()
  renderDomains()

  if (focusId) {
    queueMicrotask(() => {
      const row = main.querySelector(`.check[data-check-id="${CSS.escape(focusId)}"]`)
      if (row) {
        scrollIntoViewSafe(row)
        const ctrl = row.querySelector('input:checked, input, button')
        if (ctrl) ctrl.focus()
      }
    })
  }

  return [
    h(
      'div',
      { class: 'page-head' },
      h(
        'div',
        { class: 'page-head-main' },
        h('h1', {}, '점검'),
        h('p', { class: 'muted' }, '입력한 상황에 적용되는 항목만 보입니다. "예"라고 답해도 유효한 증적이 없으면 증적 부족으로 남습니다.'),
      ),
      h('button', { type: 'button', class: 'primary', onclick: () => queue.then(() => go('gaps')) }, '부족한 점 보기'),
    ),
    h(
      'section',
      { class: 'panel stack' },
      h(
        'div',
        { class: 'row between' },
        modeBar,
        h(
          'div',
          { class: 'row' },
          shownCountEl,
          resetBtn,
          h(
            'button',
            {
              type: 'button',
              class: 'compact',
              onclick: () =>
                domainPanels.forEach(({ det, populate }) => {
                  populate()
                  det.open = true
                }),
            },
            '모두 펼치기',
          ),
          h(
            'button',
            { type: 'button', class: 'compact', onclick: () => domainPanels.forEach(({ det }) => (det.open = false)) },
            '모두 접기',
          ),
        ),
      ),
      h('div', { class: 'filters' }, searchInput, domainSelect),
    ),
    listWrap,
    h('div', { class: 'row' }, h('button', { type: 'button', class: 'primary', onclick: () => queue.then(() => go('gaps')) }, '부족한 점 보기')),
  ]
}

// =========================================================================
// 4. 부족한 점·개선 (gaps) — 우선순위 순(서버 정렬 유지) 컴팩트 트리아지
// =========================================================================
function gapsView() {
  const all = state.assessment.checks.filter((c) => c.status !== 'na')
  const domains = Object.fromEntries([...new Set(all.map((c) => c.check.domain))].sort().map((d) => [d, d]))

  const matchesStatus = (c, st) => {
    if (!st) return isOpen(c)
    if (st === 'critical') return c.status === 'gap' || c.status === 'conflict'
    if (st === 'undecided') return c.status === 'unanswered' || c.status === 'needsFact'
    if (st === 'stale') return c.stale
    return c.status === st
  }

  const q = gapFilter.q.trim().toLowerCase()
  const list = all.filter(
    (c) =>
      matchesStatus(c, gapFilter.status) &&
      (!gapFilter.domain || c.check.domain === gapFilter.domain) &&
      (!gapFilter.legal || c.legal) &&
      (!gapFilter.fw || c.frameworks.includes(gapFilter.fw)) &&
      (!q || `${c.check.id} ${c.required} ${c.reason} ${c.check.domain} ${refs(c)}`.toLowerCase().includes(q)),
  )

  const set = (k) => (v) => {
    gapFilter[k] = v
    draw()
  }
  const hasAnyFilter = Boolean(gapFilter.status || gapFilter.domain || gapFilter.legal || gapFilter.fw || gapFilter.q)

  const counts = {
    critical: all.filter((c) => c.status === 'gap' || c.status === 'conflict').length,
    partial: all.filter((c) => c.status === 'partial').length,
    noEvidence: all.filter((c) => c.status === 'noEvidence').length,
    undecided: all.filter((c) => c.status === 'unanswered' || c.status === 'needsFact').length,
    met: all.filter((c) => c.status === 'met').length,
  }

  const kpiCells = [
    ['critical', '부족·불일치', counts.critical, counts.critical ? 'is-bad' : ''],
    ['partial', '부분 충족', counts.partial, counts.partial ? 'is-warn' : ''],
    ['noEvidence', '증적 부족', counts.noEvidence, counts.noEvidence ? 'is-info' : ''],
    ['undecided', '미판단', counts.undecided, ''],
    ['met', '충족', counts.met, counts.met ? 'is-ok' : ''],
  ]

  const rows = list.map((c) => gapRow(c, false))

  const prioSummary = ['긴급', '높음', '보통', '낮음']
    .map((p) => [p, list.filter((c) => c.priorityName === p).length])
    .filter(([, n]) => n > 0)
    .map(([p, n]) => `${p} ${n}`)
    .join(' · ')

  return [
    h(
      'div',
      { class: 'page-head' },
      h(
        'div',
        { class: 'page-head-main' },
        h('h1', {}, `부족한 점 ${list.length}건과 개선 방법`),
        h(
          'p',
          { class: 'muted' },
          prioSummary ? `서버 우선순위 순 · ${prioSummary}` : '서버가 계산한 우선순위 순서대로 표시합니다.',
        ),
      ),
      h(
        'div',
        { class: 'row' },
        rows.length
          ? [
              h('button', { type: 'button', class: 'compact', onclick: () => rows.forEach((d) => (d.open = true)) }, '모두 펼치기'),
              h('button', { type: 'button', class: 'compact', onclick: () => rows.forEach((d) => (d.open = false)) }, '모두 접기'),
            ]
          : null,
        hasAnyFilter
          ? h(
              'button',
              {
                type: 'button',
                class: 'compact ghost',
                onclick: () => {
                  Object.assign(gapFilter, { status: '', domain: '', legal: '', fw: '', q: '' })
                  draw()
                },
              },
              '필터 초기화',
            )
          : null,
      ),
    ),
    h(
      'div',
      { class: 'kpi-strip', role: 'group', 'aria-label': '상태별 요약 필터' },
      kpiCells.map(([key, label, n, cls]) =>
        h(
          'button',
          {
            type: 'button',
            class: 'kpi-cell',
            'aria-pressed': gapFilter.status === key ? 'true' : 'false',
            onclick: () => set('status')(gapFilter.status === key ? '' : key),
          },
          h('span', { class: 'kpi-label' }, label),
          h('span', { class: `kpi-val ${cls}` }, n),
        ),
      ),
    ),
    h(
      'div',
      { class: 'filters' },
      h('input', {
        type: 'search',
        'aria-label': '부족한 점 검색',
        placeholder: '항목·근거·조문 검색',
        value: gapFilter.q,
        oninput: (e) => {
          gapFilter.q = e.target.value
          const pos = e.target.selectionStart
          draw()
          const next = main.querySelector('input[aria-label="부족한 점 검색"]')
          if (next) {
            next.focus()
            if (pos !== null) next.setSelectionRange(pos, pos)
          }
        },
      }),
      select(
        gapFilter.status,
        {
          '': '부족한 것 전체',
          critical: '부족·불일치',
          undecided: '미판단 (미응답·상황 확인)',
          stale: '1년 넘음 · 재확인 필요',
          ...statusNames,
        },
        set('status'),
        '상태',
      ),
      select(
        gapFilter.fw,
        { '': '모든 기준', ...Object.fromEntries(state.assessment.frameworks.map((f) => [f.id, f.title])) },
        set('fw'),
        '기준',
      ),
      select(gapFilter.domain, { '': '모든 영역', ...domains }, set('domain'), '영역'),
      select(gapFilter.legal, { '': '법적 의무와 인증 요구', 1: '법적 의무만' }, set('legal'), '의무 구분'),
    ),
    rows.length
      ? h('section', { class: 'panel panel-tight' }, rows)
      : h('p', { class: 'notice' }, '조건에 맞는 항목이 없습니다.'),
    h('h2', {}, '기준 조항별 상태'),
    ...state.assessment.frameworks.map((f) =>
      h(
        'details',
        { class: 'panel' },
        h(
          'summary',
          { class: 'disclosure-head' },
          h(
            'span',
            { class: 'row' },
            h('strong', {}, f.title),
            h('span', { class: 'small muted num' }, `${f.applicable}/${f.total} 적용 · 충족 ${f.counts.met}`),
          ),
        ),
        f.id === 'ismsp'
          ? h(
              'div',
              { class: 'row panel-action-row' },
              h(
                'button',
                { type: 'button', class: 'compact', onclick: () => go('ismsp') },
                '인증기준에서 고시 원문·요건별 상태 보기',
              ),
            )
          : null,
        table(
          ['조항', '이름', '상태', '연결 점검'],
          f.requirements.map((r) => [r.id, r.title, tag(`s-${r.status}`, statusNames[r.status]), r.checks.join(', ')]),
        ),
      ),
    ),
  ]
}

// =========================================================================
// 4-2. ISMS-P 인증기준 (ismsp) — 영역·항목군별 101개 기준, 고시 원문·요건별 상태
// =========================================================================
function ismspView() {
  const fw = state.assessment.frameworks.find((f) => f.id === 'ismsp')
  if (!fw) {
    return [
      h(
        'div',
        { class: 'page-head' },
        h(
          'div',
          { class: 'page-head-main' },
          h('h1', {}, '인증기준'),
          h('p', { class: 'muted' }, 'ISMS 또는 ISMS-P 인증기준 항목과 요건별 이행 현황을 확인합니다.'),
        ),
      ),
      h(
        'div',
        { class: 'notice row between' },
        h('span', {}, '현재 준비할 기준에 ISMS 또는 ISMS-P가 선택되어 있지 않습니다. 상황 입력에서 선택하면 인증기준을 볼 수 있습니다.'),
        h('button', { type: 'button', class: 'primary compact', onclick: () => go('facts') }, '상황 입력으로 이동'),
      ),
    ]
  }

  const byCheck = new Map(state.assessment.checks.map((c) => [c.check.id, c]))
  const areaKey = (r) => `${r.id.split('.')[0]}. ${r.group}`
  const subKey = (r) => r.id.split('.').slice(0, 2).join('.')
  const subgroupLabel = (code) => (ismspSubgroups[code] ? `${code} ${ismspSubgroups[code]}` : code)
  const areas = [...new Set(fw.requirements.map(areaKey))]
  if (ismspFilter.area && !areas.includes(ismspFilter.area)) ismspFilter.area = ''

  const matchesStatus = (r, st) => {
    if (!st) return true
    if (st === 'open') return isOpen(r)
    if (st === 'critical') return r.status === 'gap' || r.status === 'conflict'
    if (st === 'undecided') return r.status === 'unanswered' || r.status === 'needsFact'
    return r.status === st
  }

  const kpiCounts = {
    critical: fw.counts.gap + fw.counts.conflict,
    partial: fw.counts.partial,
    noEvidence: fw.counts.noEvidence,
    undecided: fw.counts.unanswered + fw.counts.needsFact,
    met: fw.counts.met,
  }
  const kpiCells = [
    ['critical', '부족·불일치', kpiCounts.critical, kpiCounts.critical ? 'is-bad' : ''],
    ['partial', '부분 충족', kpiCounts.partial, kpiCounts.partial ? 'is-warn' : ''],
    ['noEvidence', '증적 부족', kpiCounts.noEvidence, kpiCounts.noEvidence ? 'is-info' : ''],
    ['undecided', '미판단', kpiCounts.undecided, ''],
    ['met', '충족', kpiCounts.met, kpiCounts.met ? 'is-ok' : ''],
  ]

  const kpiRefs = new Map()
  const areaRefs = new Map()
  const critPanels = []
  const listHost = h('div', {})
  const countEl = h('span', { class: 'small muted num' }, '')

  const searchInput = h('input', {
    type: 'search',
    'aria-label': '인증기준 검색',
    placeholder: '항목 번호, 제목, 고시 원문, 요건, 점검 ID로 찾기',
    value: ismspFilter.q,
    oninput: (e) => {
      ismspFilter.q = e.target.value
      renderList()
    },
  })
  const statusSelect = select(
    ismspFilter.status,
    {
      '': '모든 상태',
      open: '부족·개선 필요',
      critical: '부족·불일치',
      undecided: '미판단 (미응답·상황 확인)',
      ...statusNames,
    },
    (v) => {
      ismspFilter.status = v
      renderList()
    },
    '인증기준 상태',
  )
  const resetBtn = h(
    'button',
    {
      type: 'button',
      class: 'compact ghost',
      hidden: true,
      onclick: () => {
        Object.assign(ismspFilter, { status: '', area: '', q: '' })
        searchInput.value = ''
        statusSelect.value = ''
        renderList()
      },
    },
    '필터 초기화',
  )
  const expandAllBtn = h(
    'button',
    {
      type: 'button',
      class: 'compact',
      onclick: () =>
        critPanels.forEach(({ det, populate }) => {
          populate()
          det.open = true
        }),
    },
    '모두 펼치기',
  )
  const collapseAllBtn = h(
    'button',
    {
      type: 'button',
      class: 'compact',
      onclick: () => critPanels.forEach(({ det }) => (det.open = false)),
    },
    '모두 접기',
  )

  const kpiStrip = h(
    'div',
    { class: 'kpi-strip', role: 'group', 'aria-label': '인증기준 상태별 요약 필터' },
    kpiCells.map(([key, label, n, cls]) => {
      const btn = h(
        'button',
        {
          type: 'button',
          class: 'kpi-cell',
          'aria-pressed': ismspFilter.status === key ? 'true' : 'false',
          onclick: () => {
            ismspFilter.status = ismspFilter.status === key ? '' : key
            statusSelect.value = ismspFilter.status
            renderList()
          },
        },
        h('span', { class: 'kpi-label' }, label),
        h('span', { class: `kpi-val ${cls}` }, n),
      )
      kpiRefs.set(key, btn)
      return btn
    }),
  )

  const areaBar = h(
    'div',
    { class: 'chip-row', role: 'group', 'aria-label': '영역 필터' },
    [
      ['', `전체 (${fw.requirements.length})`],
      ...areas.map((aName) => [aName, `${aName} (${fw.requirements.filter((r) => areaKey(r) === aName).length})`]),
    ].map(([val, label]) => {
      const btn = h(
        'button',
        {
          type: 'button',
          class: 'chip-btn',
          'aria-pressed': ismspFilter.area === val ? 'true' : 'false',
          onclick: () => {
            ismspFilter.area = val
            renderList()
          },
        },
        label,
      )
      areaRefs.set(val, btn)
      return btn
    }),
  )

  function criterionEl(r, query) {
    const pts = Array.isArray(r.points) ? r.points : []
    const snippet = query
      ? excerptAround(r.text || '', query) ||
        pts.map((pt) => excerptAround(pt.text, query)).find(Boolean) ||
        null
      : null

    const bodyHost = h('div', {})
    const det = h(
      'details',
      { class: 'crit-item', 'data-req-id': r.id },
      h(
        'summary',
        { class: 'crit-sum' },
        h(
          'div',
          { class: 'crit-sum-main' },
          h(
            'div',
            { class: 'crit-sum-top' },
            h('span', { class: 'crit-id mono' }, highlightText(r.id, query)),
            h('span', { class: 'crit-title' }, highlightText(r.title, query)),
            tag(`s-${r.status}`, statusNames[r.status]),
          ),
          h(
            'div',
            { class: 'small muted num' },
            pts.length ? `요건 ${pts.length}개 · 연결 점검 ${r.checks.length}개` : `연결 점검 ${r.checks.length}개`,
          ),
          snippet ? h('div', { class: 'law-snippet' }, snippet) : null,
        ),
        h('span', { class: 'crit-chevron', 'aria-hidden': 'true' }),
      ),
      bodyHost,
    )

    const renderLinkedCheck = (cid) => {
      const cr = byCheck.get(cid)
      if (!cr) {
        return h(
          'div',
          { class: 'linked-check-row' },
          h('span', { class: 'muted small' }, `${cid} (현재 선택한 기준 외)`),
        )
      }
      return h(
        'div',
        { class: 'linked-check-row', 'data-linked-check': cid },
        h(
          'div',
          { class: 'linked-check-main' },
          h(
            'div',
            { class: 'row' },
            tag(`s-${cr.status}`, statusNames[cr.status]),
            h('span', { class: 'mono small muted' }, cid),
            cr.answeredAt ? h('span', { class: 'small muted check-date' }, `판단일 ${cr.answeredAt}`) : null,
            cr.stale ? tag('s-stale', '1년 넘음 · 재확인 필요') : null,
          ),
          h('div', {}, cr.required),
        ),
        h(
          'button',
          { type: 'button', class: 'compact', 'data-jump-check': cid, onclick: () => jumpToCheck(cid) },
          '점검 보기',
        ),
      )
    }

    const populate = () => {
      if (bodyHost.dataset.ready) return
      bodyHost.dataset.ready = '1'
      bodyHost.replaceChildren(
        h(
          'div',
          { class: 'crit-body' },
          r.text
            ? h(
                'div',
                {},
                h('div', { class: 'law-subhead' }, '인증기준 원문 (고시 별표 7)'),
                h('p', { class: 'crit-official' }, highlightText(r.text, query)),
              )
            : null,
          pts.length
            ? h(
                'div',
                {},
                h('div', { class: 'law-subhead' }, `확인 요건별 상태 (${pts.length}개)`),
                h(
                  'div',
                  { class: 'crit-points' },
                  pts.map((pt) => {
                    const pSt = pointStatus(pt, byCheck)
                    return h(
                      'div',
                      { class: 'crit-point', 'data-point-status': pSt },
                      h(
                        'div',
                        { class: 'crit-point-head' },
                        tag(`s-${pSt}`, statusNames[pSt]),
                        h('span', { class: 'crit-point-text' }, highlightText(pt.text, query)),
                      ),
                      h('div', { class: 'linked-checks' }, pt.checks.map(renderLinkedCheck)),
                    )
                  }),
                ),
              )
            : r.checks.length
              ? h(
                  'div',
                  {},
                  h('div', { class: 'law-subhead' }, `연결된 점검 (${r.checks.length}개)`),
                  h('div', { class: 'linked-checks' }, r.checks.map(renderLinkedCheck)),
                )
              : null,
        ),
      )
    }

    det.addEventListener('toggle', () => {
      if (det.open) populate()
    })
    critPanels.push({ det, populate })
    return det
  }

  const renderList = () => {
    critPanels.length = 0
    const q = ismspFilter.q.trim()
    const qLow = q.toLowerCase()

    for (const [k, btn] of kpiRefs) btn.setAttribute('aria-pressed', ismspFilter.status === k ? 'true' : 'false')
    for (const [aVal, btn] of areaRefs) btn.setAttribute('aria-pressed', ismspFilter.area === aVal ? 'true' : 'false')
    statusSelect.value = ismspFilter.status

    const filtered = fw.requirements.filter((r) => {
      if (ismspFilter.area && areaKey(r) !== ismspFilter.area) return false
      if (!matchesStatus(r, ismspFilter.status)) return false
      if (qLow) {
        const hay = [
          r.id,
          r.title,
          r.group,
          subgroupLabel(subKey(r)),
          r.text ?? '',
          ...(r.points ?? []).flatMap((pt) => [
            pt.text,
            ...pt.checks,
            ...pt.checks.map((cid) => byCheck.get(cid)?.check.need ?? ''),
          ]),
        ]
          .join(' ')
          .toLowerCase()
        if (!hay.includes(qLow)) return false
      }
      return true
    })

    countEl.textContent = `${filtered.length}/${fw.requirements.length}항목`
    const hasFilter = Boolean(ismspFilter.status || ismspFilter.area || q)
    resetBtn.hidden = !hasFilter
    expandAllBtn.hidden = filtered.length === 0
    collapseAllBtn.hidden = filtered.length === 0

    if (!filtered.length) {
      listHost.replaceChildren(h('p', { class: 'notice' }, '조건에 맞는 인증기준 항목이 없습니다.'))
      return
    }

    const byArea = Map.groupBy(filtered, areaKey)
    listHost.replaceChildren(
      ...[...byArea].map(([aName, areaReqs]) => {
        const areaCounts = tallyStatuses(areaReqs)
        const areaApplicable = areaReqs.length - areaCounts.na
        const bySub = Map.groupBy(areaReqs, subKey)
        return h(
          'section',
          { class: 'ismsp-area', 'data-area': aName },
          h(
            'div',
            { class: 'ismsp-area-head' },
            h('h2', {}, aName),
            h(
              'div',
              { class: 'ismsp-area-stats' },
              h('span', { class: 'small muted num' }, `${areaReqs.length}항목 · 충족 ${areaCounts.met}/${areaApplicable}`),
              h('div', { class: 'ismsp-area-bar' }, bar(areaCounts)),
            ),
          ),
          ...[...bySub].map(([code, subReqs]) => {
            const metN = subReqs.filter((r) => r.status === 'met').length
            return h(
              'section',
              { class: 'panel crit-group', 'data-subgroup': code },
              h(
                'div',
                { class: 'crit-group-head' },
                h('h3', {}, subgroupLabel(code)),
                h('span', { class: 'small muted num' }, `${subReqs.length}항목 · 충족 ${metN}`),
              ),
              ...subReqs.map((r) => criterionEl(r, q)),
            )
          }),
        )
      }),
    )
  }

  renderList()

  return [
    h(
      'div',
      { class: 'page-head' },
      h(
        'div',
        { class: 'page-head-main' },
        h('h1', {}, fw.title),
        h(
          'p',
          { class: 'muted' },
          `적용 ${fw.applicable}/${fw.total}항목 · 충족 ${fw.counts.met}항목 · 항목을 펼치면 고시 원문과 요건별 상태·연결 점검이 나타납니다.`,
        ),
      ),
      h('div', { class: 'row' }, expandAllBtn, collapseAllBtn, resetBtn),
    ),
    kpiStrip,
    h(
      'section',
      { class: 'panel stack' },
      h('div', { class: 'filters' }, searchInput, statusSelect),
      h('div', { class: 'row between' }, areaBar, countEl),
    ),
    listHost,
    h(
      'div',
      { class: 'disclaimer-stack' },
      h(
        'p',
        { class: 'muted small' },
        '상세 원문은 인증 고시 별표 7 원문입니다. 확인 요건은 원문을 바탕으로 이 도구가 나눈 항목이며, KISA 안내서의 세부 확인사항과 다를 수 있습니다.',
      ),
    ),
  ]
}

// =========================================================================
// 5. 상황 검토 (review) — Priority #1
//    핵심: 질문 답변 시 DOM 전체 재렌더 금지(초점·스크롤·열린 묶음 유지),
//    추정 예 vs 확정 예 구분, 미완료 시 '나머지' 비확정 명시, 331조문 빠른 응답성
// =========================================================================
function reviewView() {
  const rootBox = h('div', {}, h('p', { class: 'muted' }, '법령 전문을 불러오는 중…'))

  const mount = () => {
    const titleInput = h('input', {
      value: situation.title,
      placeholder: '예: 해외 상담 SaaS 도입',
      oninput: (e) => {
        situation.title = e.target.value
      },
    })
    const textInput = h('textarea', {
      class: 'tall',
      value: situation.text,
      placeholder: '누가 누구의 어떤 개인정보를, 왜, 어떻게, 어디로 처리하는지 적으세요. 실제 개인정보는 적지 마세요.',
      oninput: (e) => {
        situation.text = e.target.value
      },
    })

    const workspaceHost = h('div', {})
    const savedHost = h('div', {})

    // 영구 마운트되는 질문/결과 DOM 참조
    let ws = null

    const runReview = async ({ resetUI = false, quiet = false } = {}) => {
      if (!situation.text.trim()) return fail(new Error('상황을 적으세요'))
      const seq = ++reviewSeq
      if (!quiet) {
        saved.className = ''
        saved.textContent = '검토 중…'
      }
      try {
        const res = await (
          await api('/api/review', {
            method: 'POST',
            body: JSON.stringify({ text: situation.text, topics: situation.topics }),
          })
        ).json()
        if (seq !== reviewSeq) return
        situation.result = res
        clearAlert()
        saved.className = ''
        saved.textContent = '검토 완료'
        if (resetUI || !ws) {
          reviewOpenTiers.clear()
          reviewOpenTiers.add('direct')
          reviewOpenProvisions.clear()
          situation.tierFilter = 'all'
          situation.resultQuery = ''
          buildWorkspace(res)
        } else {
          patchWorkspace(res)
        }
      } catch (e) {
        if (seq === reviewSeq) fail(e)
      }
    }

    const download = async (full) => {
      try {
        const r = await api('/api/review/document', {
          method: 'POST',
          body: JSON.stringify({
            title: situation.title || '제목 없음',
            text: situation.text,
            topics: situation.topics,
            conclusion: situation.conclusion,
            full,
          }),
        })
        const url = URL.createObjectURL(await r.blob())
        h('a', { href: url, download: '상황검토서.md' }).click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      } catch (e) {
        fail(e)
      }
    }

    const keepReview = () => {
      if (!situation.text.trim()) return fail(new Error('상황을 적으세요'))
      const entry = {
        id: `RV-${crypto.randomUUID().slice(0, 8)}`,
        title: situation.title.trim() || '제목 없음',
        text: situation.text,
        topics: { ...situation.topics },
        conclusion: situation.conclusion,
        createdOn: state.today,
        lawVersion: law.texts.map((t) => `${t.title} ${t.effective}`).join(', '),
      }
      save('reviews', [...state.data.reviews, entry], false, renderSavedList)
    }

    const reopenReview = (v) => {
      situation.title = v.title
      situation.text = v.text
      situation.topics = { ...v.topics }
      situation.conclusion = v.conclusion
      situation.result = null
      titleInput.value = v.title
      textInput.value = v.text
      ws = null
      runReview({ resetUI: true })
    }

    const resetReview = () => {
      situation.title = ''
      situation.text = ''
      situation.topics = {}
      situation.conclusion = ''
      situation.result = null
      titleInput.value = ''
      textInput.value = ''
      ws = null
      workspaceHost.replaceChildren()
      titleInput.focus()
    }

    function buildWorkspace(r) {
      const statusBox = h('section', { class: 'review-status', role: 'status', 'aria-live': 'polite' })
      const statusTitle = h('div', { class: 'review-status-title' })
      const statusCount = h('span', { class: 'small muted num' })
      const statusProgress = h('progress', { class: 'review-progress', max: law.topics.length, value: 0 })
      const statusNote = h('p', { class: 'small' })
      statusBox.append(h('div', { class: 'review-status-head' }, statusTitle, statusCount), statusProgress, statusNote)

      // 왼쪽: 37개 주제 질문 (영구 DOM — 답변 시 절대 재생성·접기·초점 유실 없음)
      const qCountTag = h('span', { class: 'tag s-partial num' })
      const resetTopicsBtn = h(
        'button',
        {
          type: 'button',
          class: 'compact ghost',
          onclick: () => {
            situation.topics = {}
            patchQuestions(situation.result)
            runReview({ quiet: true })
          },
        },
        '질문 초기화',
      )

      const groups = [...Map.groupBy(law.topics, (t) => t.group)]
      const groupRefs = []
      const topicRefs = new Map()
      const orderedTopicIds = []

      const applyTopicPatch = (patch) => {
        situation.topics = { ...situation.topics, ...patch }
        // 낙관적 즉시 UI 갱신 후 서버 계산 반영
        patchQuestions(situation.result)
        runReview({ quiet: true })
      }

      const focusAdjacentTopic = (topicId, delta, colIndex) => {
        const idx = orderedTopicIds.indexOf(topicId)
        if (idx === -1) return
        for (let i = idx + delta; i >= 0 && i < orderedTopicIds.length; i += delta) {
          const nextId = orderedTopicIds[i]
          const ref = topicRefs.get(nextId)
          if (ref && ref.groupDetails.open) {
            const btn = colIndex === 0 ? ref.yesBtn : ref.noBtn
            btn.focus()
            return
          }
        }
      }

      const isUnmatchedOpen = (curR, t) => {
        if (situation.topics[t.id]) return false
        const topicHit = curR.topics.find((x) => x.id === t.id)
        if (topicHit?.matched?.length) return false
        if (curR.overruled.some((o) => o.title === t.title && o.matched.length)) return false
        return curR.open.includes(t.id)
      }

      const groupNodes = groups.map(([groupName, ts], gIdx) => {
        const openInGroup = ts.filter((t) => r.open.includes(t.id))
        const badgeEl = h('span', { class: 'tag s-partial num' })
        const detailsEl = h('details', { class: 'panel topic-group', open: openInGroup.length > 0 })
        const summaryEl = h('summary', {}, h('span', {}, groupName), badgeEl)

        const rowNodes = ts.map((t) => {
          orderedTopicIds.push(t.id)
          const hintEl = h('div', { class: 'topic-hint', hidden: true })
          const yesBtn = h(
            'button',
            {
              type: 'button',
              class: 'choice-btn',
              'data-topic': t.id,
              'data-choice': 'yes',
              'aria-pressed': 'false',
              onclick: () => applyTopicPatch({ [t.id]: 'yes' }),
              onkeydown: (e) => {
                if (e.key === 'ArrowRight') {
                  e.preventDefault()
                  noBtn.focus()
                } else if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  focusAdjacentTopic(t.id, 1, 0)
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  focusAdjacentTopic(t.id, -1, 0)
                }
              },
            },
            '예',
          )
          const noBtn = h(
            'button',
            {
              type: 'button',
              class: 'choice-btn',
              'data-topic': t.id,
              'data-choice': 'no',
              'aria-pressed': 'false',
              onclick: () => applyTopicPatch({ [t.id]: 'no' }),
              onkeydown: (e) => {
                if (e.key === 'ArrowLeft') {
                  e.preventDefault()
                  yesBtn.focus()
                } else if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  focusAdjacentTopic(t.id, 1, 1)
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  focusAdjacentTopic(t.id, -1, 1)
                }
              },
            },
            '아니오',
          )
          topicRefs.set(t.id, { topic: t, hintEl, yesBtn, noBtn, groupDetails: detailsEl })
          return h(
            'div',
            { class: 'topic-row', 'data-topic-row': t.id },
            h('div', { class: 'topic-text' }, h('div', { class: 'topic-q' }, t.q), hintEl),
            h('div', { class: 'topic-choices', role: 'group', 'aria-label': t.q }, yesBtn, noBtn),
          )
        })

        const bulkBtn = h(
          'button',
          {
            type: 'button',
            class: 'compact',
            'data-bulk-group': groupName,
            onclick: () => {
              const curR = situation.result
              const remaining = ts.filter((t) => isUnmatchedOpen(curR, t))
              if (!remaining.length) return
              const patch = Object.fromEntries(remaining.map((t) => [t.id, 'no']))
              applyTopicPatch(patch)
              // 다음 미응답 묶음의 첫 질문으로 초점 이동(초점 유실 방지)
              let moved = false
              for (let offset = 1; offset < groupRefs.length; offset++) {
                const nextG = (gIdx + offset) % groupRefs.length
                const candidate = groupRefs[nextG].topics.find((t) => isUnmatchedOpen(curR, t))
                if (candidate) {
                  groupRefs[nextG].detailsEl.open = true
                  topicRefs.get(candidate.id)?.yesBtn.focus()
                  moved = true
                  break
                }
              }
              if (!moved) summaryEl.focus()
            },
          },
          '찾지 못한 남은 질문 모두 아니오',
        )

        groupRefs.push({ groupName, topics: ts, detailsEl, summaryEl, badgeEl, bulkBtn })
        detailsEl.append(
          summaryEl,
          h('div', { class: 'topic-group-body' }, h('div', { class: 'topic-rows' }, rowNodes), h('div', { class: 'topic-group-foot' }, bulkBtn)),
        )
        return detailsEl
      })

      const qCol = h(
        'div',
        { class: 'review-q-col' },
        h(
          'div',
          { class: 'section-bar' },
          h('div', { class: 'row' }, h('h2', {}, '이 상황에 해당하나요?'), qCountTag),
          resetTopicsBtn,
        ),
        h(
          'div',
          { class: 'topic-legend' },
          h('span', {}, h('span', { class: 'swatch swatch-suggest' }, '예(추정)'), '글에서 찾음(미확정)'),
          h('span', {}, h('span', { class: 'swatch swatch-yes' }, '예'), '직접 확인'),
          h('span', {}, h('span', { class: 'swatch swatch-no' }, '아니오'), '해당 없음'),
        ),
        ...groupNodes,
      )

      // 오른쪽: 결과 영역 (티어 요약 + 주제별 질문 + 관련 점검 + 331개 조문 + 검토 의견)
      const tierStrip = h('div', { class: 'tier-strip', role: 'group', 'aria-label': '조문 분류별 요약' })
      const tierStripRefs = new Map()
      for (const [k, label] of Object.entries(tiers)) {
        const countEl = h('span', { class: 'tier-btn-count' }, '0')
        const subEl = h('span', { class: 'tier-btn-sub', hidden: true }, '미확정')
        const btn = h(
          'button',
          {
            type: 'button',
            class: 'tier-btn',
            'data-tier-btn': k,
            'aria-pressed': 'false',
            onclick: () => {
              situation.tierFilter = situation.tierFilter === k ? 'all' : k
              if (situation.tierFilter !== 'all') reviewOpenTiers.add(k)
              patchResults(situation.result)
            },
          },
          h('span', { class: 'tier-btn-name' }, label),
          countEl,
          subEl,
        )
        tierStripRefs.set(k, { btn, countEl, subEl })
        tierStrip.append(btn)
      }

      const matchedTopicsBox = h('div', {})
      const relatedChecksBox = h('div', {})
      const provisionsHeading = h('h2', {}, '')
      const resultSearchInput = h('input', {
        type: 'search',
        'aria-label': '검토 결과 조문 검색',
        placeholder: '결과 내 조문 검색',
        value: situation.resultQuery,
        oninput: (e) => {
          situation.resultQuery = e.target.value
          patchProvisions(situation.result)
        },
      })
      const tierPanelsHost = h('div', {})

      // 검토 의견 textarea는 영구 마운트하여 입력 중 초점 유지
      const conclusionInput = h('textarea', {
        'aria-label': '검토 의견',
        placeholder: '검토 결론, 추가로 확인할 사실, 보완 조치를 적으세요.',
        value: situation.conclusion,
        oninput: (e) => {
          situation.conclusion = e.target.value
        },
      })

      const conclusionSection = h(
        'section',
        { class: 'panel stack' },
        h('h3', {}, '검토 의견'),
        conclusionInput,
        h(
          'div',
          { class: 'row' },
          h('button', { type: 'button', class: 'primary', onclick: keepReview }, '검토 저장'),
          h('button', { type: 'button', onclick: () => download(false) }, '검토서 내려받기'),
          h('button', { type: 'button', onclick: () => download(true) }, '전체 조문 포함 내려받기'),
        ),
        h('p', { class: 'muted small' }, '낱말과 조문 연결로 찾은 결과이며 법률 판단이 아닙니다.'),
      )

      const rCol = h(
        'div',
        { class: 'review-r-col' },
        tierStrip,
        matchedTopicsBox,
        relatedChecksBox,
        h(
          'div',
          { class: 'section-bar' },
          provisionsHeading,
          h('div', { class: 'row' }, resultSearchInput),
        ),
        tierPanelsHost,
        conclusionSection,
      )

      ws = {
        statusBox,
        statusTitle,
        statusCount,
        statusProgress,
        statusNote,
        qCountTag,
        resetTopicsBtn,
        groupRefs,
        topicRefs,
        tierStripRefs,
        matchedTopicsBox,
        relatedChecksBox,
        provisionsHeading,
        tierPanelsHost,
      }

      workspaceHost.replaceChildren(statusBox, h('div', { class: 'review-grid' }, qCol, rCol))
      patchWorkspace(r)
    }

    function patchQuestions(r) {
      if (!ws || !r) return
      const matchedMap = new Map(r.topics.map((t) => [t.id, t.matched]))
      const overruledMap = new Map(r.overruled.map((o) => [o.title, o.matched]))

      // 낙관적 계산을 위해 로컬 situation.topics도 함께 반영
      let openTotal = 0
      for (const g of ws.groupRefs) {
        let openInGroup = 0
        let yesInGroup = 0
        for (const t of g.topics) {
          const ref = ws.topicRefs.get(t.id)
          const explicit = situation.topics[t.id]
          const matched = matchedMap.get(t.id) ?? []
          const overruledMatched = overruledMap.get(t.title) ?? []
          const isTopicOpen = !explicit && matched.length === 0 && overruledMatched.length === 0 && r.open.includes(t.id)
          if (isTopicOpen) openInGroup++

          if (explicit === 'yes') {
            yesInGroup++
            ref.yesBtn.className = 'choice-btn is-yes'
            ref.yesBtn.textContent = '예'
            ref.yesBtn.setAttribute('aria-pressed', 'true')
            ref.yesBtn.setAttribute('data-state', 'answered')
            ref.noBtn.className = 'choice-btn'
            ref.noBtn.setAttribute('aria-pressed', 'false')
            if (matched.length) {
              ref.hintEl.hidden = false
              ref.hintEl.className = 'topic-hint muted'
              ref.hintEl.textContent = `글에서 찾음: ${matched.join(', ')} · 예로 확정됨`
            } else {
              ref.hintEl.hidden = true
            }
          } else if (explicit === 'no') {
            ref.yesBtn.className = 'choice-btn'
            ref.yesBtn.textContent = '예'
            ref.yesBtn.setAttribute('aria-pressed', 'false')
            ref.yesBtn.removeAttribute('data-state')
            ref.noBtn.className = 'choice-btn is-no'
            ref.noBtn.setAttribute('aria-pressed', 'true')
            const kw = overruledMatched.length ? overruledMatched : matched
            if (kw.length) {
              ref.hintEl.hidden = false
              ref.hintEl.className = 'topic-hint is-overruled'
              ref.hintEl.textContent = `글에 낱말(${kw.join(', ')})이 있지만 아니오로 답함`
            } else {
              ref.hintEl.hidden = true
            }
          } else if (matched.length > 0) {
            // 추정 '예'는 확정 '예'와 시각적·의미적으로 명확히 구분
            yesInGroup++
            ref.yesBtn.className = 'choice-btn is-suggested'
            ref.yesBtn.textContent = '예 (추정)'
            ref.yesBtn.setAttribute('aria-pressed', 'false')
            ref.yesBtn.setAttribute('data-state', 'suggested')
            ref.noBtn.className = 'choice-btn'
            ref.noBtn.setAttribute('aria-pressed', 'false')
            ref.hintEl.hidden = false
            ref.hintEl.className = 'topic-hint is-suggest'
            ref.hintEl.textContent = `글에서 추정: ${matched.join(', ')} — 눌러 확정하거나 아니오 선택`
          } else {
            ref.yesBtn.className = 'choice-btn'
            ref.yesBtn.textContent = '예'
            ref.yesBtn.setAttribute('aria-pressed', 'false')
            ref.yesBtn.removeAttribute('data-state')
            ref.noBtn.className = 'choice-btn'
            ref.noBtn.setAttribute('aria-pressed', 'false')
            ref.hintEl.hidden = true
          }
        }
        openTotal += openInGroup
        g.badgeEl.className = `tag num ${openInGroup ? 's-partial' : 's-met'}`
        g.badgeEl.textContent = openInGroup ? `${openInGroup}개 남음` : `완료${yesInGroup ? ` · 예 ${yesInGroup}` : ''}`
        g.bulkBtn.disabled = openInGroup === 0
        g.bulkBtn.textContent = '찾지 못한 남은 질문 모두 아니오'
      }

      ws.qCountTag.className = `tag num ${openTotal ? 's-partial' : 's-met'}`
      ws.qCountTag.textContent = openTotal ? `${openTotal}개 남음` : '답변 완료'
      ws.resetTopicsBtn.disabled = Object.keys(situation.topics).length === 0
    }

    function patchProvisions(r) {
      if (!ws || !r) return
      const q = situation.resultQuery.trim().toLowerCase()
      const totalItems = r.items.length
      ws.provisionsHeading.textContent = `조문 ${totalItems}개 전체`

      const visibleTiers = situation.tierFilter === 'all' ? Object.entries(tiers) : [[situation.tierFilter, tiers[situation.tierFilter]]]
      const nodes = visibleTiers.map(([k, label]) => {
        const allInTier = r.items.filter((i) => i.tier === k)
        const list = q
          ? allInTier.filter((i) => {
              const p = law.byId.get(i.id)
              return `${lawName(p)} ${i.reasons.join(' ')}`.toLowerCase().includes(q)
            })
          : allInTier
        const isOpenTier = reviewOpenTiers.has(k) || situation.tierFilter === k || Boolean(q)
        const bodyHost = h('div', { class: 'tier-panel-body' })
        const det = h(
          'details',
          { class: 'panel tier-panel', open: isOpenTier, 'data-tier': k },
          h(
            'summary',
            {},
            h(
              'span',
              { class: 'row' },
              h('strong', {}, `${label} ${allInTier.length}개`),
              q ? h('span', { class: 'small muted num' }, `(필터 ${list.length}개)`) : null,
              k === 'rest' && r.open.length > 0 ? tag('s-partial', '질문 완료 전 미확정') : null,
            ),
            h('span', { class: 'small muted' }, isOpenTier ? '' : '펼쳐서 보기'),
          ),
          bodyHost,
        )

        const fillTier = () => {
          if (bodyHost.dataset.filled) return
          bodyHost.dataset.filled = '1'
          const kids = []
          if (k === 'rest' && r.open.length > 0) {
            kids.push(
              h(
                'div',
                { class: 'notice is-warn small' },
                `아직 답하지 않은 질문이 ${r.open.length}개 남아 있습니다. 모든 질문에 답하기 전까지 '나머지' 조문을 무관한 조문으로 보지 마세요.`,
              ),
            )
          }
          if (k === 'confirm' && r.open.length > 0) {
            kids.push(
              h(
                'div',
                { class: 'notice small' },
                `왼쪽의 남은 질문 ${r.open.length}개에 예·아니오로 답하면 해당 조문이 '직접 관련'이나 '나머지'로 정리됩니다.`,
              ),
            )
          }
          if (!list.length) {
            kids.push(h('p', { class: 'small muted' }, '해당하는 조문이 없습니다.'))
          } else {
            for (const item of list) {
              const p = law.byId.get(item.id)
              kids.push(
                provisionEl(p, {
                  reasons: item.reasons,
                  query: situation.resultQuery,
                  defaultOpen: reviewOpenProvisions.has(p.id),
                  onToggle: (opened) => {
                    if (opened) reviewOpenProvisions.add(p.id)
                    else reviewOpenProvisions.delete(p.id)
                  },
                }),
              )
            }
          }
          bodyHost.replaceChildren(...kids)
        }

        if (isOpenTier) fillTier()
        det.addEventListener('toggle', () => {
          if (det.open) {
            reviewOpenTiers.add(k)
            fillTier()
          } else {
            reviewOpenTiers.delete(k)
          }
        })
        return det
      })

      ws.tierPanelsHost.replaceChildren(...nodes)
    }

    function patchResults(r) {
      if (!ws || !r) return
      const totalTopics = law.topics.length
      const doneTopics = totalTopics - r.open.length
      ws.statusProgress.max = totalTopics
      ws.statusProgress.value = doneTopics
      if (r.open.length > 0) {
        ws.statusBox.className = 'review-status is-incomplete'
        ws.statusTitle.textContent = `검토 미완료 · 질문 ${r.open.length}개 남음`
        ws.statusCount.textContent = `${totalTopics}개 주제 중 ${doneTopics}개 확인됨`
        ws.statusNote.textContent =
          "글의 낱말만으로는 일부 주제만 찾습니다. 남은 질문에 모두 답해야 '확인 필요' 조문이 정리되고 '나머지' 조문을 확정할 수 있습니다."
      } else {
        ws.statusBox.className = 'review-status is-complete'
        ws.statusTitle.textContent = `질문 ${totalTopics}개 모두 확인 완료`
        ws.statusCount.textContent = `전체 조문 ${r.items.length}개 분류 완료`
        ws.statusNote.textContent = '모든 주제를 확인했습니다. 직접 관련·항상 확인·함께 볼 조문을 검토하고 아래에 검토 의견을 남기세요.'
      }

      for (const [k, { btn, countEl, subEl }] of ws.tierStripRefs) {
        const n = r.items.filter((i) => i.tier === k).length
        countEl.textContent = String(n)
        btn.setAttribute('aria-pressed', situation.tierFilter === k ? 'true' : 'false')
        if (k === 'rest') subEl.hidden = r.open.length === 0
      }

      // 찾은 주제와 확인할 질문
      ws.matchedTopicsBox.replaceChildren(
        h(
          'details',
          { class: 'panel', open: r.topics.length > 0 && r.topics.length <= 6 },
          h(
            'summary',
            { class: 'disclosure-head' },
            h('span', { class: 'row' }, h('strong', {}, `찾은 주제와 확인할 질문 (${r.topics.length}개)`)),
          ),
          r.topics.length
            ? r.topics.map((t) =>
                h(
                  'div',
                  { class: 'topic-ask-item' },
                  h(
                    'div',
                    { class: 'row' },
                    h('strong', {}, t.title),
                    h('span', { class: 'small muted' }, t.matched.length ? `낱말: ${t.matched.join(', ')}` : '직접 선택(예)'),
                  ),
                  h('ul', {}, t.ask.map((q) => h('li', {}, q))),
                ),
              )
            : h('p', { class: 'small muted' }, '찾은 주제가 없습니다. 왼쪽 질문에 답하거나 상황을 더 구체적으로 적으세요.'),
          r.overruled.length
            ? h(
                'p',
                { class: 'small muted' },
                `글에 낱말이 있지만 아니오로 답한 주제: ${r.overruled.map((o) => `${o.title}(${o.matched.join(', ')})`).join(', ')}`,
              )
            : null,
        ),
      )

      // 우리 조직의 관련 점검 상태
      const byCheck = new Map(state.assessment.checks.map((c) => [c.check.id, c]))
      const linkedChecks = r.checks.map((id) => byCheck.get(id)).filter((c) => c && c.status !== 'na')
      if (linkedChecks.length) {
        ws.relatedChecksBox.replaceChildren(
          h(
            'details',
            { class: 'panel', open: false },
            h(
              'summary',
              { class: 'disclosure-head' },
              h(
                'span',
                { class: 'row' },
                h('strong', {}, `우리 조직의 관련 점검 상태 (${linkedChecks.length}건)`),
                h(
                  'span',
                  { class: 'small muted num' },
                  `부족·개선 필요 ${linkedChecks.filter(isOpen).length}건`,
                ),
              ),
            ),
            table(
              ['상태', '점검', ''],
              linkedChecks.map((c) => [
                tag(`s-${c.status}`, statusNames[c.status]),
                c.required,
                h('button', { type: 'button', class: 'compact', onclick: () => jumpToCheck(c.check.id) }, '보기'),
              ]),
            ),
          ),
        )
      } else {
        ws.relatedChecksBox.replaceChildren()
      }

      patchProvisions(r)
    }

    function patchWorkspace(r) {
      patchQuestions(r)
      patchResults(r)
    }

    function renderSavedList() {
      if (!state.data.reviews.length) {
        savedHost.replaceChildren()
        return
      }
      savedHost.replaceChildren(
        h('h2', {}, `저장한 검토 (${state.data.reviews.length}건)`),
        h(
          'section',
          { class: 'panel panel-tight' },
          table(
            ['날짜', '제목', '주제 답변', '적용 원문(시행일)', ''],
            state.data.reviews.map((v) => [
              v.createdOn,
              v.title,
              `${Object.keys(v.topics ?? {}).length}개`,
              v.lawVersion,
              h(
                'div',
                { class: 'row' },
                h('button', { type: 'button', class: 'compact', onclick: () => reopenReview(v) }, '열기'),
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'compact danger',
                    onclick: () =>
                      confirm('이 검토를 삭제할까요?') &&
                      save(
                        'reviews',
                        state.data.reviews.filter((x) => x.id !== v.id),
                        false,
                        renderSavedList,
                      ),
                  },
                  '삭제',
                ),
              ),
            ]),
            new Set([0, 2]),
          ),
        ),
      )
    }

    const composer = h(
      'section',
      { class: 'panel' },
      field('제목', titleInput),
      field('상황', textInput),
      h(
        'div',
        { class: 'row' },
        h('button', { type: 'button', class: 'primary', onclick: () => runReview({ resetUI: !ws }) }, '전체 조문 검토'),
        h('button', { type: 'button', class: 'ghost', onclick: resetReview }, '새로 쓰기'),
      ),
    )

    rootBox.replaceChildren(composer, workspaceHost, savedHost)
    renderSavedList()
    if (situation.result) {
      buildWorkspace(situation.result)
    }
  }

  needLaw().then(mount).catch(fail)

  return [
    h(
      'div',
      { class: 'page-head' },
      h(
        'div',
        { class: 'page-head-main' },
        h('h1', {}, '상황 검토'),
        h(
          'p',
          { class: 'muted' },
          '실제 상황이나 계획을 적으면 개인정보 보호법·시행령·안전성 확보조치 기준의 모든 조문을 나눠 보여 줍니다. 아니오라고 답하지 않은 주제의 조문은 확인 필요로 남깁니다.',
        ),
      ),
    ),
    rootBox,
  ]
}

// =========================================================================
// 6. 법령 전문 (law) — Priority #2
// =========================================================================
function resolveArticleId(raw) {
  const s = raw.trim().replace(/\s+/g, ' ')
  if (!s || !law) return null
  if (law.byId.has(s)) return s

  // "법 제28조의8" -> "제28조의8"
  const stripLaw = s.replace(/^법\s*/, '')
  if (law.byId.has(stripLaw)) return stripLaw

  // 정규화: 시행령/영/기준/고시 + 번호
  const m = /^(법|시행령|영|안전성 확보조치 기준|고시|기준)?\s*(?:제)?(\d+)(?:조)?(?:(?:의|-)(\d+))?$/.exec(s)
  if (m) {
    const pref = !m[1] || m[1] === '법' ? '' : m[1] === '시행령' || m[1] === '영' ? '영 ' : '기준 '
    const num = `제${m[2]}조${m[3] ? `의${m[3]}` : ''}`
    const candidate = `${pref}${num}`
    if (law.byId.has(candidate)) return candidate
  }

  // 별표 매칭 ("별표 2", "별표2", "영 별표 2", "기준 별표")
  const norm = s.replace(/\s+/g, '')
  const exactNorm = law.provisions.find((p) => p.id.replace(/\s+/g, '') === norm || lawIdText(p).replace(/\s+/g, '') === norm)
  if (exactNorm) return exactNorm.id

  const byAnnex = law.provisions.find((p) => p.kind === 'annex' && p.id.replace(/\s+/g, '').includes(norm))
  if (byAnnex) return byAnnex.id

  const partial = law.provisions.find(
    (p) => p.id.includes(s) || lawIdText(p).includes(s) || p.title.includes(s),
  )
  return partial ? partial.id : null
}

function lawView() {
  const box = h('div', {}, h('p', { class: 'muted' }, '법령 전문을 불러오는 중…'))

  needLaw()
    .then(() => {
      const listHost = h('div', {})
      const countEl = h('span', { class: 'small muted num' }, '')
      const jumpStatus = h('span', { class: 'small muted', role: 'status', 'aria-live': 'polite' }, '')
      const datalistId = 'law-article-ids'
      const datalist = h(
        'datalist',
        { id: datalistId },
        law.provisions.map((p) => h('option', { value: p.id, label: `${lawIdText(p)} ${p.title}` })),
      )
      const jumpInput = h('input', {
        id: 'law-jump-input',
        type: 'text',
        list: datalistId,
        'aria-label': '조문 번호로 바로 이동',
        placeholder: '예: 제28조의8, 영 30, 별표 2',
      })
      const searchInput = h('input', {
        type: 'search',
        'aria-label': '조문 검색',
        placeholder: '조문 번호, 제목, 본문 낱말',
        value: lawFilter.q,
      })

      const sourceCounts = Object.fromEntries(
        ['law', 'decree', 'safeguard'].map((s) => [s, law.provisions.filter((p) => p.source === s).length]),
      )
      const sourceSelect = select(
        lawFilter.source,
        {
          '': `모든 원문 (${law.provisions.length})`,
          law: `개인정보 보호법 (${sourceCounts.law})`,
          decree: `시행령 (${sourceCounts.decree})`,
          safeguard: `안전성 확보조치 기준 (${sourceCounts.safeguard})`,
        },
        (v) => {
          lawFilter.source = v
          fill()
        },
        '원문',
      )
      const roleSelect = select(
        lawFilter.role,
        { '': '모든 역할', ...roleNames },
        (v) => {
          lawFilter.role = v
          fill()
        },
        '역할',
      )

      const upcomingBtn = h(
        'button',
        {
          type: 'button',
          class: 'chip-btn',
          'aria-pressed': lawFilter.upcomingOnly ? 'true' : 'false',
          onclick: () => {
            lawFilter.upcomingOnly = !lawFilter.upcomingOnly
            upcomingBtn.setAttribute('aria-pressed', lawFilter.upcomingOnly ? 'true' : 'false')
            fill()
          },
        },
        `시행 예정 포함 (${law.provisions.filter((p) => !p.text || p.upcoming || p.pending).length})`,
      )
      const annexBtn = h(
        'button',
        {
          type: 'button',
          class: 'chip-btn',
          'aria-pressed': lawFilter.annexOnly ? 'true' : 'false',
          onclick: () => {
            lawFilter.annexOnly = !lawFilter.annexOnly
            annexBtn.setAttribute('aria-pressed', lawFilter.annexOnly ? 'true' : 'false')
            fill()
          },
        },
        `별표만 (${law.provisions.filter((p) => p.kind === 'annex').length})`,
      )

      const resetBtn = h(
        'button',
        {
          type: 'button',
          class: 'compact ghost',
          onclick: () => {
            Object.assign(lawFilter, { q: '', source: '', role: '', upcomingOnly: false, annexOnly: false })
            searchInput.value = ''
            sourceSelect.value = ''
            roleSelect.value = ''
            upcomingBtn.setAttribute('aria-pressed', 'false')
            annexBtn.setAttribute('aria-pressed', 'false')
            jumpStatus.textContent = ''
            fill()
          },
        },
        '필터 초기화',
      )

      const fill = (openId = '') => {
        const q = lawFilter.q.trim()
        const qLow = q.toLowerCase()
        const hit = law.provisions.filter((p) => {
          if (lawFilter.source && p.source !== lawFilter.source) return false
          if (lawFilter.role && p.role !== lawFilter.role) return false
          if (lawFilter.upcomingOnly && p.text && !p.upcoming && !p.pending) return false
          if (lawFilter.annexOnly && p.kind !== 'annex') return false
          if (
            qLow &&
            !`${lawIdText(p)} ${p.id} ${p.title} ${p.text} ${p.upcoming?.text ?? ''} ${p.pending ?? ''}`
              .toLowerCase()
              .includes(qLow)
          ) {
            return false
          }
          return true
        })

        countEl.textContent = `${hit.length}/${law.provisions.length}개`
        resetBtn.hidden = !(q || lawFilter.source || lawFilter.role || lawFilter.upcomingOnly || lawFilter.annexOnly)

        if (!hit.length) {
          listHost.replaceChildren(h('p', { class: 'notice' }, '조건에 맞는 조문이 없습니다.'))
          return
        }

        const chapters = Map.groupBy(
          hit,
          (p) => `${law.texts.find((t) => t.id === p.source).title} · ${p.chapter}`,
        )
        listHost.replaceChildren(
          ...[...chapters].map(([chapterTitle, ps]) =>
            h(
              'section',
              { class: 'panel' },
              h(
                'div',
                { class: 'row between' },
                h('h3', {}, chapterTitle),
                h('span', { class: 'small muted num' }, `${ps.length}개`),
              ),
              ...ps.map((p) => provisionEl(p, { query: q, defaultOpen: p.id === openId })),
            ),
          ),
        )
      }

      searchInput.addEventListener('input', (e) => {
        lawFilter.q = e.target.value
        fill()
      })

      const jumpForm = h(
        'form',
        {
          class: 'jump-form',
          onsubmit: (e) => {
            e.preventDefault()
            const targetId = resolveArticleId(jumpInput.value)
            if (!targetId) {
              jumpStatus.textContent = '일치하는 조문을 찾지 못했습니다.'
              return
            }
            const p = law.byId.get(targetId)
            // 현재 필터에 가려져 있다면 필터 해제 후 이동
            let el = listHost.querySelector(`details.law[data-law-id="${CSS.escape(targetId)}"]`)
            let cleared = false
            if (!el) {
              Object.assign(lawFilter, { q: '', source: '', role: '', upcomingOnly: false, annexOnly: false })
              searchInput.value = ''
              sourceSelect.value = ''
              roleSelect.value = ''
              upcomingBtn.setAttribute('aria-pressed', 'false')
              annexBtn.setAttribute('aria-pressed', 'false')
              cleared = true
              fill(targetId)
              el = listHost.querySelector(`details.law[data-law-id="${CSS.escape(targetId)}"]`)
            }
            if (el) {
              listHost.querySelectorAll('details.law.is-jumped').forEach((x) => x.classList.remove('is-jumped'))
              el.open = true
              el.classList.add('is-jumped')
              scrollIntoViewSafe(el)
              const sum = el.querySelector('summary')
              if (sum) sum.focus()
              jumpStatus.textContent = cleared
                ? `필터를 해제하고 ${lawName(p)}(으)로 이동했습니다.`
                : `${lawName(p)}(으)로 이동했습니다.`
            }
          },
        },
        jumpInput,
        h('button', { type: 'submit', class: 'primary' }, '이동'),
      )

      box.replaceChildren(
        datalist,
        h(
          'details',
          { class: 'panel' },
          h(
            'summary',
            { class: 'disclosure-head' },
            h(
              'span',
              { class: 'row' },
              h('strong', {}, '적용 원문 정보'),
              h('span', { class: 'small muted' }, law.texts.map((t) => `${t.title}(시행 ${t.effective})`).join(' · ')),
            ),
          ),
          table(
            ['원문', '판', '시행일', '내려받은 날'],
            law.texts.map((t) => [t.title, t.version, t.effective, t.fetchedOn]),
            new Set([2, 3]),
          ),
        ),
        h(
          'section',
          { class: 'panel law-controls' },
          h(
            'div',
            { class: 'law-search-row' },
            h('div', { class: 'field-wrap' }, h('label', { class: 'field', for: 'law-jump-input' }, h('span', {}, '조문 번호 이동')), jumpForm),
            h('div', { class: 'field-wrap' }, field('조문·본문 검색', searchInput)),
          ),
          h('div', { class: 'filters' }, sourceSelect, roleSelect),
          h(
            'div',
            { class: 'row between' },
            h('div', { class: 'chip-row' }, upcomingBtn, annexBtn, resetBtn),
            countEl,
          ),
          jumpStatus,
        ),
        listHost,
      )
      fill()
    })
    .catch(fail)

  return [
    h(
      'div',
      { class: 'page-head' },
      h(
        'div',
        { class: 'page-head-main' },
        h('h1', {}, '법령 전문'),
        h('p', { class: 'muted' }, '현행 조문, 시행 예정 조문, 별표, 부칙을 모두 담았습니다.'),
      ),
    ),
    box,
  ]
}

// =========================================================================
// 7. 처리 흐름 (flows)
// =========================================================================
const flowFields = {
  name: ['업무 이름', '예: 회원 가입·관리'],
  purpose: ['처리 목적', ''],
  subjects: ['정보주체', '예: 쇼핑몰 회원'],
  items: ['개인정보 항목', '예: 이름, 휴대전화번호'],
  legalBasis: ['처리 근거', '예: 법 제15조①4 계약 이행'],
  source: ['수집 출처', ''],
  retention: ['보유기간', ''],
  destruction: ['파기 방법', ''],
  thirdParties: ['제3자 제공', '없으면 비움'],
  processors: ['처리 위탁', '없으면 비움'],
  overseas: ['국외 이전', '없으면 비움'],
  systems: ['시스템', ''],
}

function flowsView() {
  const issuesHost = h('div', {})
  const renderIssues = () => {
    const issues = state.assessment.flowIssues
    if (!issues.length) {
      issuesHost.replaceChildren()
      return
    }
    issuesHost.replaceChildren(
      h(
        'section',
        { class: 'panel' },
        h('h3', {}, `발견된 누락·모순 (${issues.length}건)`),
        table(
          ['업무', '문제', '개선', '근거'],
          issues.map((i) => [i.name, i.issue, i.fix, i.basis]),
        ),
      ),
    )
  }
  renderIssues()

  const form = h(
    'form',
    { class: 'grid' },
    Object.entries(flowFields).map(([k, [l, ph]]) => field(l, h('input', { name: k, placeholder: ph, required: k === 'name' }))),
    h('div', { class: 'wide' }, h('button', { type: 'submit', class: 'primary' }, '추가')),
  )
  form.addEventListener('submit', (e) => {
    e.preventDefault()
    save('flows', [...state.data.flows, { id: `PF-${crypto.randomUUID().slice(0, 8)}`, ...Object.fromEntries(new FormData(form)) }], true)
  })

  return [
    h(
      'div',
      { class: 'page-head' },
      h(
        'div',
        { class: 'page-head-main' },
        h('h1', {}, '개인정보 처리 흐름'),
        h('p', { class: 'muted' }, '업무별로 적으면 누락과 조직 상황과의 모순을 찾아 줍니다. 처리방침과 처리 현황표의 원본이 됩니다.'),
      ),
    ),
    issuesHost,
    ...(state.data.flows.length
      ? state.data.flows.map((f) =>
          h(
            'details',
            { class: 'panel' },
            h(
              'summary',
              { class: 'disclosure-head' },
              h(
                'span',
                { class: 'row' },
                h('strong', {}, f.name),
                f.items ? h('span', { class: 'small muted' }, f.items) : null,
                f.overseas ? tag('s-verify', '국외 이전') : null,
                f.processors ? tag('s-na', '위탁') : null,
              ),
            ),
            h(
              'div',
              { class: 'grid' },
              Object.entries(flowFields).map(([k, [l]]) =>
                field(
                  l,
                  h('input', {
                    value: f[k] ?? '',
                    onchange: (e) =>
                      save(
                        'flows',
                        state.data.flows.map((x) => (x.id === f.id ? { ...x, [k]: e.target.value.trim() } : x)),
                        false,
                        renderIssues,
                      ),
                  }),
                ),
              ),
            ),
            h(
              'div',
              { class: 'row' },
              h(
                'button',
                {
                  type: 'button',
                  class: 'compact danger',
                  onclick: () =>
                    confirm(`"${f.name}"을(를) 삭제할까요?`) &&
                    save(
                      'flows',
                      state.data.flows.filter((x) => x.id !== f.id),
                      true,
                    ),
                },
                '삭제',
              ),
            ),
          ),
        )
      : [h('p', { class: 'notice' }, '등록된 처리 흐름이 없습니다. 아래에서 업무를 추가하세요.')]),
    h('h2', {}, '업무 추가'),
    h('section', { class: 'panel' }, form),
  ]
}

// =========================================================================
// 8. 위험 (risks)
// =========================================================================
function risksView() {
  const list = [...state.data.risks].sort((a, b) => b.likelihood * b.impact - a.likelihood * a.impact)
  const r = pre.risk
  pre.risk = null
  const scale = { 1: '1 매우 낮음', 2: '2 낮음', 3: '3 보통', 4: '4 높음', 5: '5 매우 높음' }
  const treat = { mitigate: '감소', avoid: '회피', transfer: '전가', accept: '수용' }
  const sel = (name, options, value) =>
    h(
      'select',
      { name },
      Object.entries(options).map(([v, t]) => h('option', { value: v, selected: v === String(value) }, t)),
    )
  const form = h(
    'form',
    { class: 'grid' },
    field('자산·업무', h('input', { name: 'asset', required: true, value: r ? r.check.domain : '' })),
    field('위협·취약점', h('input', { name: 'threat', required: true, value: r ? `미흡: ${r.check.need}` : '' })),
    field('가능성', sel('likelihood', scale, 3)),
    field('영향', sel('impact', scale, r?.check.severity === 'high' ? 4 : 3)),
    field('처리 방법', sel('treatment', treat, 'mitigate')),
    field('조치 계획', h('textarea', { name: 'plan', value: r ? r.check.fix.join('\n') : '' })),
    field('담당자', h('input', { name: 'owner' })),
    field('기한', h('input', { name: 'due', type: 'date' })),
    h('div', { class: 'wide' }, h('button', { type: 'submit', class: 'primary' }, '추가')),
  )
  form.addEventListener('submit', (e) => {
    e.preventDefault()
    const v = Object.fromEntries(new FormData(form))
    save(
      'risks',
      [
        ...state.data.risks,
        {
          ...v,
          id: `R-${crypto.randomUUID().slice(0, 8)}`,
          likelihood: Number(v.likelihood),
          impact: Number(v.impact),
          ...(r ? { check: r.check.id } : {}),
        },
      ],
      true,
    )
  })

  const scoreTag = (n) => h('span', { class: `risk-score ${n >= 15 ? 'risk-hi' : n >= 9 ? 'risk-mid' : 'risk-lo'}` }, n)

  return [
    h(
      'div',
      { class: 'page-head' },
      h(
        'div',
        { class: 'page-head-main' },
        h('h1', {}, '위험평가와 처리 계획'),
        h('p', { class: 'muted' }, '위험도(가능성 × 영향)가 높은 순서대로 정리됩니다.'),
      ),
    ),
    r ? h('div', { class: 'notice small' }, `부족한 점에서 불러왔습니다: ${r.check.need}`) : null,
    list.length
      ? h(
          'section',
          { class: 'panel panel-tight' },
          table(
            ['위험도', '자산', '위협·취약점', '처리', '조치 계획', '담당·기한', ''],
            list.map((x) => [
              scoreTag(x.likelihood * x.impact),
              x.asset,
              x.threat,
              treat[x.treatment],
              x.plan,
              [x.owner, x.due].filter(Boolean).join(' · ') || '-',
              h(
                'button',
                {
                  type: 'button',
                  class: 'compact danger',
                  onclick: () =>
                    confirm('이 위험을 삭제할까요?') &&
                    save(
                      'risks',
                      state.data.risks.filter((y) => y.id !== x.id),
                      true,
                    ),
                },
                '삭제',
              ),
            ]),
            new Set([0]),
          ),
        )
      : h('p', { class: 'notice' }, '등록한 위험이 없습니다. 부족한 점에서 "위험으로 등록"을 누르면 내용이 채워집니다.'),
    h('h2', {}, '위험 추가'),
    h('section', { class: 'panel' }, form),
  ]
}

// =========================================================================
// 9. 증적 (evidence)
// =========================================================================
function evidenceView() {
  const scoped = state.assessment.checks.filter((c) => c.status !== 'na').sort((a, b) => a.check.id.localeCompare(b.check.id))
  const file = h('input', { type: 'file' })
  const checkOptions = scoped.map((c) => h('option', { value: c.check.id, selected: c.check.id === pre.check }, `${c.check.id} — ${c.check.need}`))
  const checks = h('select', { multiple: true, size: 8, required: true, 'aria-label': '연결할 점검' }, checkOptions)
  const checkFilterInput = h('input', {
    type: 'search',
    'aria-label': '연결할 점검 목록 찾기',
    placeholder: '점검 ID나 이름으로 목록 좁히기',
    oninput: (e) => {
      const q = e.target.value.trim().toLowerCase()
      for (const opt of checkOptions) {
        opt.hidden = Boolean(q) && !opt.textContent.toLowerCase().includes(q)
      }
    },
  })
  const picked = scoped.find((c) => c.check.id === pre.check)
  pre.check = ''

  const form = h(
    'form',
    { class: 'grid' },
    field('증적 이름', h('input', { name: 'title', required: true, value: picked ? picked.check.evidence[0] : '' })),
    field('담당자', h('input', { name: 'owner' })),
    field('수집일', h('input', { name: 'collectedOn', type: 'date', required: true, value: state.today })),
    field('유효기간 (일)', h('input', { name: 'validDays', type: 'number', min: 1, required: true, value: 365 })),
    field('파일 (20MB 이하)', file),
    field('또는 링크', h('input', { name: 'link', type: 'url', placeholder: 'https://' })),
    h(
      'div',
      { class: 'wide stack' },
      field('연결할 점검 목록 찾기', checkFilterInput),
      field('연결할 점검 (여러 개 선택 가능)', checks),
    ),
    h('div', { class: 'wide' }, h('button', { type: 'submit', class: 'primary' }, '추가')),
  )

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const v = Object.fromEntries(new FormData(form))
    const f = file.files[0]
    try {
      if (f && f.size > 20_000_000) throw new Error('20MB 이하 파일만 추가할 수 있습니다')
      if (!f && !v.link) throw new Error('파일이나 링크가 필요합니다')
      const selectedChecks = [...checks.selectedOptions].map((o) => o.value)
      if (!selectedChecks.length) throw new Error('연결할 점검을 하나 이상 선택하세요')
      const fileBase64 =
        f &&
        (await new Promise((ok, no) => {
          const r = new FileReader()
          r.onload = () => ok(String(r.result).split(',')[1] ?? '')
          r.onerror = () => no(r.error)
          r.readAsDataURL(f)
        }))
      state = await (
        await api('/api/evidence', {
          method: 'POST',
          body: JSON.stringify({
            title: v.title,
            owner: v.owner,
            collectedOn: v.collectedOn,
            validDays: Number(v.validDays),
            link: v.link || undefined,
            checks: selectedChecks,
            fileName: f?.name,
            fileBase64,
          }),
        })
      ).json()
      saved.className = ''
      saved.textContent = '저장됨'
      clearAlert()
      draw()
    } catch (x) {
      fail(x)
    }
  })

  return [
    h(
      'div',
      { class: 'page-head' },
      h(
        'div',
        { class: 'page-head-main' },
        h('h1', {}, '증적'),
        h('p', { class: 'muted' }, '파일은 작업 폴더에 복사하고 SHA-256을 기록합니다. 만료되거나 내용이 바뀐 증적은 충족 근거로 쓰지 않습니다.'),
      ),
    ),
    picked ? h('div', { class: 'notice small' }, `부족한 점에서 연결할 점검을 선택했습니다: ${picked.check.id} — ${picked.check.need}`) : null,
    state.data.evidence.length
      ? h(
          'section',
          { class: 'panel panel-tight' },
          table(
            ['상태', '증적', '담당자', '만료일', '연결 점검', ''],
            state.data.evidence.map((e) => {
              const s = state.evidenceStates[e.id]
              return [
                tag(`s-${s.state}`, evidenceStateNames[s.state]),
                [
                  h('div', {}, e.title),
                  e.link ? h('div', { class: 'small muted' }, e.link) : null,
                  e.sha256 ? h('div', { class: 'small muted mono' }, `sha256 ${e.sha256.slice(0, 12)}…`) : null,
                ],
                e.owner || '-',
                s.expires,
                e.checks.join(', '),
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'compact danger',
                    onclick: () =>
                      confirm('증적 연결을 삭제할까요? 파일은 evidence 폴더에 남습니다.') &&
                      save(
                        'evidence',
                        state.data.evidence.filter((x) => x.id !== e.id),
                        true,
                      ),
                  },
                  '삭제',
                ),
              ]
            }),
            new Set([3]),
          ),
        )
      : h('p', { class: 'notice' }, '등록한 증적이 없습니다.'),
    h('h2', {}, '증적 추가'),
    h('section', { class: 'panel' }, form),
  ]
}

// =========================================================================
// 10. 문서 (docs) & 11. 기준 (sources)
// =========================================================================
function docsView() {
  const download = async (kind, ext) => {
    try {
      const url = URL.createObjectURL(await (await api(`/api/documents/${kind}`)).blob())
      h('a', { href: url, download: `${kind}.${ext}` }).click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e) {
      fail(e)
    }
  }
  return [
    h(
      'div',
      { class: 'page-head' },
      h(
        'div',
        { class: 'page-head-main' },
        h('h1', {}, '문서'),
        h('p', { class: 'muted' }, '입력한 값으로 초안을 만듭니다. 모르는 내용은 지어내지 않고 【작성 필요】로 남깁니다.'),
      ),
    ),
    h(
      'section',
      { class: 'panel panel-tight' },
      table(
        ['문서', '형식', ''],
        Object.entries(state.catalog.documents).map(([k, [t, ext]]) => [
          t,
          tag('s-na', ext === 'csv' ? 'CSV(엑셀)' : 'Markdown'),
          h('button', { type: 'button', class: 'compact', onclick: () => download(k, ext) }, '내려받기'),
        ]),
      ),
    ),
  ]
}

function sourcesView() {
  const s = state.catalog.sources
  return [
    h(
      'div',
      { class: 'page-head' },
      h(
        'div',
        { class: 'page-head-main' },
        h('h1', {}, '근거 기준'),
        h('p', { class: 'muted' }, `원문 확인일 ${s.checkedOn}`),
      ),
    ),
    h(
      'section',
      { class: 'panel panel-tight' },
      table(
        ['이름', '판', '시행일', '원문'],
        s.sources.map((x) => [
          x.title,
          x.version,
          x.effective,
          h('a', { href: x.url, target: '_blank', rel: 'noreferrer' }, '열기'),
        ]),
        new Set([2]),
      ),
    ),
    h('h2', {}, '변경 주시'),
    ...s.watch.map((w) => h('section', { class: 'panel' }, h('h3', {}, w.title), h('p', { class: 'small muted' }, w.detail))),
  ]
}

// =========================================================================
// 초기화
// =========================================================================
try {
  state = await (await api('/api/state')).json()
  // 인증 성공 후 주소창 해시에서 토큰을 제거하고 화면 해시로 정규화
  history.replaceState(null, '', `#${current}`)
  draw()
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e)
  crumbTextEl.textContent = '접속 필요'
  saved.className = 'err'
  saved.textContent = '인증 필요'
  main.replaceChildren(h('div', { class: 'notice is-bad', role: 'alert' }, msg))
}
