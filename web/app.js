const token = location.hash.slice(1)
const statusNames = { gap: '부족', conflict: '답변·점검 불일치', partial: '부분 충족', noEvidence: '증적 부족', needsFact: '상황 확인 필요', unanswered: '미응답', met: '충족', na: '해당 없음' }
const barOrder = ['met', 'noEvidence', 'partial', 'conflict', 'gap', 'needsFact', 'unanswered']
const targets = { pipa: '개인정보 보호법', isms: 'ISMS(80개)', ismsp: 'ISMS-P(101개)', iso: 'ISO/IEC 27001' }
const views = { home: ['현황', home], facts: ['상황 입력', factsView], checks: ['점검', checksView], gaps: ['부족한 점·개선', gapsView], review: ['상황 검토', reviewView], flows: ['처리 흐름', flowsView], risks: ['위험', risksView], evidence: ['증적', evidenceView], docs: ['문서', docsView], law: ['법령 전문', lawView], sources: ['기준', sourcesView] }
const filter = { status: '', domain: '', legal: '', fw: '' }
let state
let current = 'home'
const main = document.getElementById('main')
const saved = document.getElementById('saved')

// 사용자 입력은 모두 텍스트 노드로만 넣습니다
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v)
    else if (k === 'class') el.className = v
    else if (k === 'value') el.value = v
    else el.setAttribute(k, v === true ? '' : v)
  }
  el.append(...kids.flat(9).filter((k) => k !== null && k !== undefined && k !== false).map((k) => (k instanceof Node ? k : String(k))))
  return el
}
const tag = (cls, text) => h('span', { class: `tag ${cls}` }, text)
const field = (label, input, help) => h('label', { class: 'field' }, h('span', {}, label), input, help && h('span', { class: 'small muted' }, help))
const table = (head, rows) => h('div', { class: 'scroll' }, h('table', {}, h('thead', {}, h('tr', {}, head.map((x) => h('th', { scope: 'col' }, x)))), h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c) => h('td', { class: typeof c === 'number' ? 'n' : '' }, c)))))))
const select = (value, options, onchange, label) => h('select', { onchange: (e) => onchange(e.target.value), 'aria-label': label }, Object.entries(options).map(([v, t]) => h('option', { value: v, selected: v === value }, t)))

async function api(path, init = {}) {
  const r = await fetch(path, { ...init, headers: { 'x-openprivacy-token': token, 'content-type': 'application/json' } })
  if (!r.ok) throw new Error((await r.json()).error)
  return r
}
let queue = Promise.resolve()
let pending = 0
/** 저장 요청을 차례로 보내 늦게 도착한 응답이 새 값을 덮지 않게 합니다. */
function save(name, value, rerender = false) {
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
      if (!pending) saved.textContent = '저장됨'
      if (rerender) draw()
    } catch (e) {
      pending--
      fail(e)
      state = await (await api('/api/state')).json()
      draw()
    }
  })
  return queue
}
function fail(e) { saved.className = 'err'; saved.textContent = e.message }

function draw() {
  document.getElementById('nav').replaceChildren(...Object.entries(views).map(([id, [label]]) => h('button', { type: 'button', 'aria-current': id === current ? 'page' : undefined, onclick: () => go(id) }, label)))
  main.replaceChildren(...[views[current][1]()].flat(9).filter(Boolean))
}
function go(id) { current = id; draw(); scrollTo(0, 0); main.focus() }
const draft = (name) => structuredClone(state.data[name])

function bar(counts) {
  const total = barOrder.reduce((n, k) => n + counts[k], 0) || 1
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('class', 'bar'); svg.setAttribute('viewBox', '0 0 100 8'); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('role', 'img')
  svg.setAttribute('aria-label', barOrder.filter((k) => counts[k]).map((k) => `${statusNames[k]} ${counts[k]}`).join(', '))
  let x = 0
  for (const k of barOrder) {
    const r = document.createElementNS(ns, 'rect')
    const w = (counts[k] / total) * 100
    r.setAttribute('x', x); r.setAttribute('width', w); r.setAttribute('height', 8); r.setAttribute('class', `f-${k}`)
    svg.append(r); x += w
  }
  return svg
}
const isOpen = (c) => !['met', 'na', 'unanswered', 'needsFact'].includes(c.status)

function home() {
  const a = state.assessment
  const top = a.checks.filter(isOpen).slice(0, 5)
  const filled = Object.keys(state.data.profile.facts).length
  const total = state.catalog.factGroups.reduce((n, g) => n + g.facts.length, 0)
  const labels = { required: '해당', verify: '확인 필요' }
  return [
    h('h1', {}, state.data.profile.facts.orgName || '우리 조직', '의 준비 현황'),
    h('p', { class: 'muted' }, `상황 ${filled}/${total}개 입력, 점검 ${a.checks.length - a.counts.unanswered - a.counts.needsFact}/${a.checks.length}개 판단`),
    h('section', { class: 'panel summary' },
      h('div', {}, h('div', { class: 'big' }, `${a.readiness}%`), h('div', { class: 'muted small' }, '충족하고 유효한 증적까지 있는 항목 비율')),
      table(['기준', '현황', '충족', '증적 부족', '부족·부분', '미판단'], a.frameworks.map((f) => [f.title, bar(f.counts), `${f.counts.met}/${f.applicable}`, f.counts.noEvidence, f.counts.gap + f.counts.conflict + f.counts.partial, f.counts.unanswered + f.counts.needsFact]))),
    h('h2', {}, '먼저 고칠 것'),
    top.length ? top.map(gapCard) : h('div', { class: 'notice' }, h('p', {}, '아직 확인된 부족한 점이 없습니다. 상황을 입력하고 점검에 답하면 여기에 표시됩니다.'), h('button', { class: 'primary', onclick: () => go(filled ? 'checks' : 'facts') }, filled ? '점검에 답하기' : '상황 입력하기')),
    a.flowIssues.length ? h('p', {}, h('button', { onclick: () => go('flows') }, `처리 흐름에서 문제 ${a.flowIssues.length}건`)) : null,
    h('h2', {}, '우리 조직에 적용되는 의무'),
    h('div', { class: 'panel' }, table(['판정', '의무', '내용', '근거'], a.obligations.filter((o) => o.status !== 'notRequired').map((o) => [tag(`s-${o.status}`, labels[o.status]), o.title, o.text, o.basis]))),
    h('p', { class: 'muted small' }, '개인정보 보호법 현황은 점검으로 확인하는 의무 조문만 셉니다. 100%여도 법 전체 준수를 뜻하지 않으며, 개별 사안은 상황 검토에서 전체 조문을 확인하세요.'),
    h('p', { class: 'muted small' }, '자가진단 결과이며 법률 자문이나 인증 심사를 대신하지 않습니다.'),
  ]
}

function factsView() {
  const p = draft('profile')
  const set = (id, v) => { if (v === undefined || v === '') delete p.facts[id]; else p.facts[id] = v; save('profile', p) }
  const input = (f) => {
    const v = p.facts[f.id]
    if (f.type === 'bool') return select(v === undefined ? '' : String(v), { '': '모름', true: '예', false: '아니오' }, (x) => set(f.id, x === '' ? undefined : x === 'true'))
    if (f.type === 'choice') return select(v ?? '', { '': '선택', ...f.options }, (x) => set(f.id, x))
    if (f.type === 'number') return h('input', { type: 'number', min: 0, step: 'any', value: v ?? '', onchange: (e) => set(f.id, e.target.value === '' ? undefined : Number(e.target.value)) })
    return h('input', { value: v ?? '', onchange: (e) => set(f.id, e.target.value.trim()) })
  }
  return [
    h('h1', {}, '우리 조직의 상황'),
    h('p', { class: 'muted' }, '모르는 값은 비워 두세요. 모름을 아니오로 처리하지 않고, 판단에 필요한 값으로 따로 알려 줍니다.'),
    h('section', { class: 'panel' }, h('h3', {}, '준비할 기준'), h('div', { class: 'row' }, Object.entries(targets).map(([id, label]) => h('label', { class: 'row' }, h('input', { type: 'checkbox', checked: p.targets.includes(id), onchange: (e) => {
      const next = e.target.checked ? [...p.targets, id] : p.targets.filter((t) => t !== id)
      if (!next.length) { e.target.checked = true; return fail(new Error('기준을 하나 이상 고르세요')) }
      p.targets = next; save('profile', p)
    } }), label)))),
    state.catalog.factGroups.map((g) => [h('h2', {}, g.title), h('section', { class: 'panel grid' }, g.facts.map((f) => field(f.unit ? `${f.label} (${f.unit})` : f.label, input(f), f.help)))]),
    h('button', { class: 'primary', onclick: () => queue.then(() => go('checks')) }, '점검으로 이동'),
  ].flat(9)
}

function answerRow(c) {
  const ans = () => state.data.answers[c.check.id] ?? { note: '', owner: '', due: '' }
  const put = (patch) => {
    const next = { ...ans(), ...patch }
    if (next.value === undefined) delete next.value
    save('answers', { ...state.data.answers, [c.check.id]: next })
  }
  const a = ans()
  const opts = [['yes', '예'], ['partial', '일부'], ['no', '아니오'], ['na', '제외']]
  const control = c.check.type === 'number'
    ? h('div', { class: 'row' }, h('input', { class: 'num', type: 'number', min: 0, value: typeof a.value === 'number' ? a.value : '', 'aria-label': c.check.need, onchange: (e) => put({ value: e.target.value === '' ? undefined : Number(e.target.value) }) }), c.check.unit)
    : h('div', { class: 'choices', role: 'radiogroup', 'aria-label': c.check.need }, opts.map(([v, t]) => h('label', {}, h('input', { type: 'radio', name: c.check.id, value: v, checked: a.value === v, onchange: () => put({ value: v }) }), t)))
  return h('div', { class: 'check' },
    h('div', {}, h('h3', {}, c.check.need), h('div', { class: 'row small muted' }, c.legal && tag('s-required', '법적 의무'), refs(c), c.status === 'needsFact' && c.reason)),
    control,
    h('details', { class: 'wide small' }, h('summary', {}, a.note || a.owner || a.due ? '메모·담당자·기한 보기' : '메모·담당자·기한 추가'),
      h('div', { class: 'grid' },
        field('현재 상황 메모 (제외할 때는 사유 필수)', h('textarea', { value: a.note, onchange: (e) => put({ note: e.target.value.trim() }) })),
        field('담당자', h('input', { value: a.owner, onchange: (e) => put({ owner: e.target.value.trim() }) })),
        field('개선 기한', h('input', { type: 'date', value: a.due, onchange: (e) => put({ due: e.target.value }) })))))
}
const refs = (c) => [c.frameworks.includes('pipa') && c.check.map.pipa.join(', '), c.frameworks.includes('ismsp') && c.check.map.ismsp.length && `ISMS-P ${c.check.map.ismsp.join(', ')}`, c.frameworks.includes('iso') && c.check.map.iso.length && `ISO ${c.check.map.iso.join(', ')}`].filter(Boolean).join(' / ')

function checksView() {
  const scoped = state.assessment.checks.filter((c) => c.status !== 'na' || state.data.answers[c.check.id]?.value === 'na')
  const domains = [...new Set(scoped.map((c) => c.check.domain))].sort()
  return [
    h('h1', {}, '점검'),
    h('p', { class: 'muted' }, '입력한 상황에 적용되는 항목만 보입니다. "예"라고 답해도 유효한 증적이 없으면 증적 부족으로 남습니다.'),
    ...domains.map((d) => {
      const list = scoped.filter((c) => c.check.domain === d).sort((x, y) => x.check.id.localeCompare(y.check.id))
      const done = list.filter((c) => state.data.answers[c.check.id]?.value !== undefined).length
      return h('details', { class: 'panel', open: domains.length === 1 }, h('summary', {}, h('strong', {}, d), ` ${done}/${list.length} 응답`), list.map(answerRow))
    }),
    h('button', { class: 'primary', onclick: () => queue.then(() => go('gaps')) }, '부족한 점 보기'),
  ]
}

function gapCard(c) {
  const ans = state.data.answers[c.check.id]
  return h('article', { class: 'panel gap' },
    h('div', { class: 'row' }, tag(`p-${c.priorityName}`, c.priorityName), tag(`s-${c.status}`, statusNames[c.status]), c.legal && tag('s-required', '법적 의무'), h('span', { class: 'small muted' }, c.check.domain)),
    h('h3', {}, c.required),
    h('dl', {}, h('dt', {}, '현재'), h('dd', {}, c.current), h('dt', {}, '부족한 점'), h('dd', {}, c.reason),
      h('dt', {}, '개선 방법'), h('dd', {}, h('ol', {}, c.check.fix.map((f) => h('li', {}, f)))),
      h('dt', {}, '준비할 증적'), h('dd', {}, c.check.evidence.join(', ')), h('dt', {}, '관련 기준'), h('dd', {}, refs(c)),
      c.sanctions.length ? [h('dt', {}, '제재 참고'), h('dd', {}, h('details', {}, h('summary', {}, c.sanctions.map((s) => `법 ${s.article} ${s.item}`).join(', ')), sanctionList(c.sanctions)))] : null,
      c.findings.length ? [h('dt', {}, '기술 점검'), h('dd', {}, c.findings.map((f) => h('div', {}, `${f.title} (${f.scanner} · ${f.target}) ${f.detail}`)))] : null,
      ans?.owner || ans?.due ? [h('dt', {}, '담당·기한'), h('dd', {}, [ans.owner, ans.due].filter(Boolean).join(' · '))] : null),
    h('div', { class: 'row' }, h('button', { onclick: () => { pre.check = c.check.id; go('evidence') } }, '증적 추가'),
      h('button', { onclick: () => { pre.risk = c; go('risks') } }, '위험으로 등록')))
}
const sanctionList = (list) => [h('p', { class: 'small muted' }, '조문 단위로 연결한 참고 정보입니다. 해당 여부는 각 호의 요건을 확인하세요.'), list.map((s) => h('p', { class: 'small' }, h('strong', {}, `${s.article} ${s.item} `), s.text.replace(/^\S+\. /, ''), h('span', { class: 'muted' }, ` — ${s.lead.slice(0, 140)}${s.lead.length > 140 ? '…' : ''}`)))]
const pre = { check: '', risk: null }

function gapsView() {
  const all = state.assessment.checks.filter((c) => c.status !== 'na')
  const list = all.filter((c) => (filter.status ? c.status === filter.status : isOpen(c)) && (!filter.domain || c.check.domain === filter.domain) && (!filter.legal || c.legal) && (!filter.fw || c.frameworks.includes(filter.fw)))
  const set = (k) => (v) => { filter[k] = v; draw() }
  const domains = Object.fromEntries([...new Set(all.map((c) => c.check.domain))].map((d) => [d, d]))
  return [
    h('h1', {}, `부족한 점 ${list.length}건과 개선 방법`),
    h('div', { class: 'filters' },
      select(filter.status, { '': '부족한 것 전체', ...statusNames }, set('status'), '상태'),
      select(filter.fw, { '': '모든 기준', ...Object.fromEntries(state.assessment.frameworks.map((f) => [f.id, f.title])) }, set('fw'), '기준'),
      select(filter.domain, { '': '모든 영역', ...domains }, set('domain'), '영역'),
      select(filter.legal, { '': '법적 의무와 인증 요구', 1: '법적 의무만' }, set('legal'), '의무 구분')),
    ...(list.length ? list.map(gapCard) : [h('p', { class: 'notice' }, '조건에 맞는 항목이 없습니다.')]),
    h('h2', {}, '기준 조항별 상태'),
    ...state.assessment.frameworks.map((f) => h('details', { class: 'panel' }, h('summary', {}, `${f.title} (${f.applicable}/${f.total} 적용)`), table(['조항', '이름', '상태', '연결 점검'], f.requirements.map((r) => [r.id, r.title, tag(`s-${r.status}`, statusNames[r.status]), r.checks.join(', ')])))),
  ]
}

const flowFields = { name: ['업무 이름', '예: 회원 가입·관리'], purpose: ['처리 목적', ''], subjects: ['정보주체', '예: 쇼핑몰 회원'], items: ['개인정보 항목', '예: 이름, 휴대전화번호'], legalBasis: ['처리 근거', '예: 법 제15조①4 계약 이행'], source: ['수집 출처', ''], retention: ['보유기간', ''], destruction: ['파기 방법', ''], thirdParties: ['제3자 제공', '없으면 비움'], processors: ['처리 위탁', '없으면 비움'], overseas: ['국외 이전', '없으면 비움'], systems: ['시스템', ''] }
function flowsView() {
  const list = state.data.flows
  const form = h('form', { class: 'grid' }, Object.entries(flowFields).map(([k, [l, ph]]) => field(l, h('input', { name: k, placeholder: ph, required: k === 'name' }))), h('div', { class: 'wide' }, h('button', { class: 'primary' }, '추가')))
  form.addEventListener('submit', (e) => { e.preventDefault(); save('flows', [...list, { id: `PF-${crypto.randomUUID().slice(0, 8)}`, ...Object.fromEntries(new FormData(form)) }], true) })
  return [
    h('h1', {}, '개인정보 처리 흐름'),
    h('p', { class: 'muted' }, '업무별로 적으면 누락과 조직 상황과의 모순을 찾아 줍니다. 처리방침과 처리 현황표의 원본이 됩니다.'),
    state.assessment.flowIssues.length ? h('section', { class: 'panel' }, table(['업무', '문제', '개선', '근거'], state.assessment.flowIssues.map((i) => [i.name, i.issue, i.fix, i.basis]))) : null,
    ...list.map((f) => h('details', { class: 'panel' }, h('summary', {}, h('strong', {}, f.name), ` ${f.items}`),
      h('div', { class: 'grid' }, Object.entries(flowFields).map(([k, [l]]) => field(l, h('input', { value: f[k], onchange: (e) => save('flows', state.data.flows.map((x) => (x.id === f.id ? { ...x, [k]: e.target.value.trim() } : x)), true) })))),
      h('p', {}, h('button', { onclick: () => confirm(`"${f.name}"을(를) 삭제할까요?`) && save('flows', list.filter((x) => x.id !== f.id), true) }, '삭제')))),
    h('h2', {}, '업무 추가'), h('section', { class: 'panel' }, form),
  ].filter(Boolean)
}

function risksView() {
  const list = [...state.data.risks].sort((a, b) => b.likelihood * b.impact - a.likelihood * a.impact)
  const r = pre.risk; pre.risk = null
  const scale = { 1: '1 매우 낮음', 2: '2 낮음', 3: '3 보통', 4: '4 높음', 5: '5 매우 높음' }
  const treat = { mitigate: '감소', avoid: '회피', transfer: '전가', accept: '수용' }
  const sel = (name, options, value) => h('select', { name }, Object.entries(options).map(([v, t]) => h('option', { value: v, selected: v === String(value) }, t)))
  const form = h('form', { class: 'grid' },
    field('자산·업무', h('input', { name: 'asset', required: true, value: r ? r.check.domain : '' })), field('위협·취약점', h('input', { name: 'threat', required: true, value: r ? `미흡: ${r.check.need}` : '' })),
    field('가능성', sel('likelihood', scale, 3)), field('영향', sel('impact', scale, r?.check.severity === 'high' ? 4 : 3)), field('처리 방법', sel('treatment', treat, 'mitigate')),
    field('조치 계획', h('textarea', { name: 'plan', value: r ? r.check.fix.join('\n') : '' })), field('담당자', h('input', { name: 'owner' })), field('기한', h('input', { name: 'due', type: 'date' })),
    h('div', { class: 'wide' }, h('button', { class: 'primary' }, '추가')))
  form.addEventListener('submit', (e) => {
    e.preventDefault()
    const v = Object.fromEntries(new FormData(form))
    save('risks', [...state.data.risks, { ...v, id: `R-${crypto.randomUUID().slice(0, 8)}`, likelihood: Number(v.likelihood), impact: Number(v.impact), ...(r ? { check: r.check.id } : {}) }], true)
  })
  return [
    h('h1', {}, '위험평가와 처리 계획'),
    list.length ? h('section', { class: 'panel' }, table(['위험도', '자산', '위협·취약점', '처리', '조치 계획', '담당·기한', ''], list.map((x) => [x.likelihood * x.impact, x.asset, x.threat, treat[x.treatment], x.plan, [x.owner, x.due].filter(Boolean).join(' '), h('button', { onclick: () => confirm('이 위험을 삭제할까요?') && save('risks', state.data.risks.filter((y) => y.id !== x.id), true) }, '삭제')]))) : h('p', { class: 'notice' }, '등록한 위험이 없습니다. 부족한 점에서 "위험으로 등록"을 누르면 내용이 채워집니다.'),
    h('h2', {}, '위험 추가'), h('section', { class: 'panel' }, form),
  ]
}

function evidenceView() {
  const names = { valid: '유효', expiring: '30일 내 만료', expired: '만료', missing: '파일 없음', modified: '내용 변경됨' }
  const scoped = state.assessment.checks.filter((c) => c.status !== 'na').sort((a, b) => a.check.id.localeCompare(b.check.id))
  const file = h('input', { type: 'file' })
  const checks = h('select', { multiple: true, size: 8, required: true }, scoped.map((c) => h('option', { value: c.check.id, selected: c.check.id === pre.check }, `${c.check.id} — ${c.check.need}`)))
  const picked = scoped.find((c) => c.check.id === pre.check); pre.check = ''
  const form = h('form', { class: 'grid' },
    field('증적 이름', h('input', { name: 'title', required: true, value: picked ? picked.check.evidence[0] : '' })), field('담당자', h('input', { name: 'owner' })),
    field('수집일', h('input', { name: 'collectedOn', type: 'date', required: true, value: state.today })), field('유효기간 (일)', h('input', { name: 'validDays', type: 'number', min: 1, required: true, value: 365 })),
    field('파일 (20MB 이하)', file), field('또는 링크', h('input', { name: 'link', type: 'url', placeholder: 'https://' })),
    h('div', { class: 'wide' }, field('연결할 점검 (여러 개 선택 가능)', checks)), h('div', { class: 'wide' }, h('button', { class: 'primary' }, '추가')))
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const v = Object.fromEntries(new FormData(form))
    const f = file.files[0]
    try {
      if (f && f.size > 20_000_000) throw new Error('20MB 이하 파일만 추가할 수 있습니다')
      if (!f && !v.link) throw new Error('파일이나 링크가 필요합니다')
      const fileBase64 = f && await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] ?? ''); r.onerror = () => no(r.error); r.readAsDataURL(f) })
      state = await (await api('/api/evidence', { method: 'POST', body: JSON.stringify({ title: v.title, owner: v.owner, collectedOn: v.collectedOn, validDays: Number(v.validDays), link: v.link || undefined, checks: [...checks.selectedOptions].map((o) => o.value), fileName: f?.name, fileBase64 }) })).json()
      saved.className = ''; saved.textContent = '저장됨'; draw()
    } catch (x) { fail(x) }
  })
  return [
    h('h1', {}, '증적'),
    h('p', { class: 'muted' }, '파일은 작업 폴더에 복사하고 SHA-256을 기록합니다. 만료되거나 내용이 바뀐 증적은 충족 근거로 쓰지 않습니다.'),
    state.data.evidence.length ? h('section', { class: 'panel' }, table(['상태', '증적', '담당자', '만료일', '연결 점검', ''], state.data.evidence.map((e) => { const s = state.evidenceStates[e.id]; return [tag(`s-${s.state}`, names[s.state]), [e.title, e.link ? h('div', { class: 'small muted' }, e.link) : null], e.owner, s.expires, e.checks.join(', '), h('button', { onclick: () => confirm('증적 연결을 삭제할까요? 파일은 evidence 폴더에 남습니다.') && save('evidence', state.data.evidence.filter((x) => x.id !== e.id), true) }, '삭제')] }))) : h('p', { class: 'notice' }, '등록한 증적이 없습니다.'),
    h('h2', {}, '증적 추가'), h('section', { class: 'panel' }, form),
  ]
}

let law
async function needLaw() {
  if (!law) {
    law = await (await api('/api/law')).json()
    law.byId = new Map(law.provisions.map((p) => [p.id, p]))
  }
  return law
}
const roleNames = { check: '점검에 연결', always: '항상 확인', situational: '상황 발생 시', reference: '참고' }
const tiers = { direct: '직접 관련', always: '항상 확인', related: '함께 볼 조문', confirm: '확인 필요', rest: '나머지' }
const lawName = (p) => (p.kind === 'addendum' ? p.id : `${p.source === 'law' ? '법 ' : ''}${p.id} ${p.title}${p.text ? '' : ' (시행 예정)'}`)
function provision(p, reasons) {
  const d = h('details', { class: 'law' }, h('summary', {}, h('strong', {}, lawName(p)), ' ', h('span', { class: 'small muted' }, reasons ? reasons.join(', ') : `${roleNames[p.role]} · ${p.why}`)))
  // 전문은 펼칠 때 만들어 조문 수백 개도 빠르게 보입니다
  d.addEventListener('toggle', () => {
    if (!d.open || d.dataset.ready) return
    d.dataset.ready = '1'
    d.append(...[
      p.pending && h('p', { class: 'notice' }, `시행 시점 주의: ${p.pending}`),
      p.text && h('pre', { class: p.kind === 'annex' ? 'text annex' : 'text' }, p.text),
      p.upcoming && h('div', {}, h('h3', {}, `시행 예정 ${p.upcoming.effective}`), h('pre', { class: 'text' }, p.upcoming.text)),
      p.implementedBy.length && h('div', {}, h('h3', {}, '세부 규정'), p.implementedBy.map((id) => provision(law.byId.get(id)))),
      p.sanctions.length && h('div', {}, h('h3', {}, '제재'), sanctionList(p.sanctions)),
      p.checks.length && h('p', { class: 'small muted' }, `연결된 점검: ${p.checks.join(', ')}`),
    ].filter(Boolean))
  })
  return d
}

const situation = { title: '', text: '', topics: {}, conclusion: '', result: null }
function reviewView() {
  const box = h('div', {}, h('p', {}, '법령 전문을 불러오는 중…'))
  needLaw().then(() => box.replaceChildren(...reviewBody().flat(9).filter(Boolean))).catch(fail)
  return [h('h1', {}, '상황 검토'), h('p', { class: 'muted' }, '실제 상황이나 계획을 적으면 개인정보 보호법·시행령·안전성 확보조치 기준의 모든 조문을 나눠 보여 줍니다. 아니오라고 답하지 않은 주제의 조문은 확인 필요로 남깁니다.'), box]
}
function topicQuestions(r, run) {
  const matched = new Map(r.topics.map((t) => [t.id, t.matched]))
  const set = (patch) => { situation.topics = { ...situation.topics, ...patch }; run() }
  return [...Map.groupBy(law.topics, (t) => t.group)].map(([g, ts]) => {
    const open = ts.filter((t) => r.open.includes(t.id))
    return h('details', { class: 'panel', open: open.length > 0 }, h('summary', {}, h('strong', {}, g), open.length ? ` ${open.length}개 남음` : ' 답변 완료'),
      ts.map((t) => {
        const v = situation.topics[t.id] ?? (matched.get(t.id)?.length ? 'yes' : '')
        return h('div', { class: 'check' }, h('div', {}, t.q, !situation.topics[t.id] && v ? h('div', { class: 'small muted' }, `글에서 찾음: ${matched.get(t.id).join(', ')}`) : null),
          h('div', { class: 'choices', role: 'radiogroup', 'aria-label': t.q }, [['yes', '예'], ['no', '아니오']].map(([k, l]) => h('label', {}, h('input', { type: 'radio', name: `t-${t.id}`, checked: v === k, onchange: () => set({ [t.id]: k }) }), l))))
      }),
      open.length ? h('button', { onclick: () => set(Object.fromEntries(open.map((t) => [t.id, 'no']))) }, '이 묶음의 남은 질문 모두 아니오') : null)
  })
}
function reviewBody() {
  const bind = (k) => (e) => { situation[k] = e.target.value }
  const run = async () => {
    if (!situation.text.trim()) return fail(new Error('상황을 적으세요'))
    try {
      situation.result = await (await api('/api/review', { method: 'POST', body: JSON.stringify({ text: situation.text, topics: situation.topics }) })).json()
      saved.className = ''; saved.textContent = '검토 완료'; draw()
    } catch (e) { fail(e) }
  }
  const download = async (full) => {
    try {
      const r = await api('/api/review/document', { method: 'POST', body: JSON.stringify({ title: situation.title || '제목 없음', text: situation.text, topics: situation.topics, conclusion: situation.conclusion, full }) })
      const url = URL.createObjectURL(await r.blob())
      h('a', { href: url, download: '상황검토서.md' }).click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e) { fail(e) }
  }
  const keep = () => save('reviews', [...state.data.reviews, { id: `RV-${crypto.randomUUID().slice(0, 8)}`, title: situation.title || '제목 없음', text: situation.text, topics: situation.topics, conclusion: situation.conclusion, createdOn: state.today, lawVersion: law.texts.map((t) => `${t.title} ${t.effective}`).join(', ') }], true)
  const open = (v) => { Object.assign(situation, { title: v.title, text: v.text, topics: v.topics, conclusion: v.conclusion, result: null }); run() }
  const r = situation.result
  const byCheck = new Map(state.assessment.checks.map((c) => [c.check.id, c]))
  return [
    h('section', { class: 'panel' },
      field('제목', h('input', { value: situation.title, oninput: bind('title'), placeholder: '예: 해외 상담 SaaS 도입' })),
      field('상황', h('textarea', { class: 'tall', value: situation.text, oninput: bind('text'), placeholder: '누가 누구의 어떤 개인정보를, 왜, 어떻게, 어디로 처리하는지 적으세요. 실제 개인정보는 적지 마세요.' })),
      h('p', {}, h('button', { class: 'primary', onclick: run }, '전체 조문 검토'))),
    r ? [
      h('h2', {}, `이 상황에 해당하나요? (${r.open.length}개 남음)`),
      topicQuestions(r, run),
      h('h2', {}, '찾은 주제와 확인할 질문'),
      h('section', { class: 'panel' }, r.topics.length ? r.topics.map((t) => h('div', {}, h('strong', {}, t.title), h('span', { class: 'small muted' }, ` ${t.matched.join(', ')}`), h('ul', {}, t.ask.map((q) => h('li', {}, q))))) : h('p', {}, '찾은 주제가 없습니다. 위 질문에 답하거나 더 구체적으로 적으세요.')),
      r.checks.some((id) => byCheck.has(id)) ? [h('h2', {}, '우리 조직의 관련 점검 상태'), h('section', { class: 'panel' }, table(['상태', '점검'], r.checks.map((id) => byCheck.get(id)).filter((c) => c && c.status !== 'na').map((c) => [tag(`s-${c.status}`, statusNames[c.status]), c.required])))] : null,
      h('h2', {}, `조문 ${r.items.length}개 전체`),
      Object.entries(tiers).map(([k, label]) => { const list = r.items.filter((i) => i.tier === k); return h('details', { class: 'panel', open: k === 'direct' }, h('summary', {}, h('strong', {}, `${label} ${list.length}개`)), list.map((i) => provision(law.byId.get(i.id), i.reasons))) }),
      h('h2', {}, '검토 의견'),
      h('section', { class: 'panel' }, h('textarea', { 'aria-label': '검토 의견', value: situation.conclusion, oninput: bind('conclusion') }), h('div', { class: 'row' }, h('button', { class: 'primary', onclick: keep }, '검토 저장'), h('button', { onclick: () => download(false) }, '검토서 내려받기'), h('button', { onclick: () => download(true) }, '전체 조문 포함 내려받기'))),
      h('p', { class: 'muted small' }, '낱말과 조문 연결로 찾은 결과이며 법률 판단이 아닙니다.'),
    ] : null,
    state.data.reviews.length ? [h('h2', {}, '저장한 검토'), h('section', { class: 'panel' }, table(['날짜', '제목', '적용 원문(시행일)', ''], state.data.reviews.map((v) => [v.createdOn, v.title, v.lawVersion, h('div', { class: 'row' }, h('button', { onclick: () => open(v) }, '열기'), h('button', { onclick: () => confirm('이 검토를 삭제할까요?') && save('reviews', state.data.reviews.filter((x) => x.id !== v.id), true) }, '삭제'))])))] : null,
  ]
}

const lawFilter = { q: '', source: '', role: '' }
function lawView() {
  const box = h('div', {}, h('p', {}, '법령 전문을 불러오는 중…'))
  const list = h('div', {})
  const fill = () => {
    const q = lawFilter.q.trim()
    const hit = law.provisions.filter((p) => (!lawFilter.source || p.source === lawFilter.source) && (!lawFilter.role || p.role === lawFilter.role) && (!q || `${p.id} ${p.title} ${p.text} ${p.upcoming?.text ?? ''}`.includes(q)))
    const chapters = Map.groupBy(hit, (p) => `${law.texts.find((t) => t.id === p.source).title} · ${p.chapter}`)
    list.replaceChildren(h('p', { class: 'muted' }, `${hit.length}/${law.provisions.length}개`), ...[...chapters].map(([c, ps]) => h('section', { class: 'panel' }, h('h3', {}, c), ps.map((p) => provision(p)))))
  }
  needLaw().then(() => {
    box.replaceChildren(
      h('section', { class: 'panel' }, table(['원문', '판', '시행일', '내려받은 날'], law.texts.map((t) => [t.title, t.version, t.effective, t.fetchedOn]))),
      h('div', { class: 'filters' }, h('input', { type: 'search', 'aria-label': '조문 검색', placeholder: '조문 번호나 낱말', value: lawFilter.q, oninput: (e) => { lawFilter.q = e.target.value; fill() } }),
        select(lawFilter.source, { '': '모든 원문', law: '법', decree: '시행령', safeguard: '안전성 확보조치 기준' }, (v) => { lawFilter.source = v; fill() }, '원문'),
        select(lawFilter.role, { '': '모든 역할', ...roleNames }, (v) => { lawFilter.role = v; fill() }, '역할')), list)
    fill()
  }).catch(fail)
  return [h('h1', {}, '법령 전문'), h('p', { class: 'muted' }, '현행 조문, 시행 예정 조문, 별표, 부칙을 모두 담았습니다.'), box]
}

function docsView() {
  const download = async (kind, ext) => {
    try {
      const url = URL.createObjectURL(await (await api(`/api/documents/${kind}`)).blob())
      h('a', { href: url, download: `${kind}.${ext}` }).click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e) { fail(e) }
  }
  return [h('h1', {}, '문서'), h('p', { class: 'muted' }, '입력한 값으로 초안을 만듭니다. 모르는 내용은 지어내지 않고 【작성 필요】로 남깁니다.'),
    h('section', { class: 'panel' }, table(['문서', '형식', ''], Object.entries(state.catalog.documents).map(([k, [t, ext]]) => [t, ext === 'csv' ? 'CSV(엑셀)' : 'Markdown', h('button', { onclick: () => download(k, ext) }, '내려받기')])))]
}

function sourcesView() {
  const s = state.catalog.sources
  return [h('h1', {}, '근거 기준'), h('p', { class: 'muted' }, `원문 확인일 ${s.checkedOn}`),
    h('section', { class: 'panel' }, table(['이름', '판', '시행일', '원문'], s.sources.map((x) => [x.title, x.version, x.effective, h('a', { href: x.url, target: '_blank', rel: 'noreferrer' }, '열기')]))),
    h('h2', {}, '변경 주시'), ...s.watch.map((w) => h('section', { class: 'panel' }, h('h3', {}, w.title), h('p', {}, w.detail)))]
}

try {
  state = await (await api('/api/state')).json()
  draw()
} catch (e) { main.replaceChildren(h('p', { class: 'notice' }, e.message)) }
