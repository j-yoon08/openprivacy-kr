import type { Catalog, Check, FrameworkId, Obligation } from './catalog.ts'
import { evaluate, missingFacts } from './condition.ts'
import { loadLaw, sanctionsFor, type Sanction } from './law.ts'
import { isoTime, seoulDay, type Answer, type Finding, type Flow, type Provision, type Target, type Transfer, type Workspace, type WorkspaceData } from './workspace.ts'

/**
 * met: 충족 + 유효 증적 / noEvidence: 충족한다고 답했지만 유효한 증적 없음 / conflict: 답과 기술 점검 결과가 어긋남
 * needsFact: 상황 값이 없어 판단 불가 / unanswered: 아직 답하지 않음
 */
export type Status = 'gap' | 'conflict' | 'partial' | 'noEvidence' | 'needsFact' | 'unanswered' | 'met' | 'na'
export const statusNames: Record<Status, string> = {
  gap: '부족', conflict: '답변·점검 불일치', partial: '부분 충족', noEvidence: '증적 부족', needsFact: '상황 확인 필요', unanswered: '미응답', met: '충족', na: '해당 없음',
}
const order: Status[] = ['gap', 'conflict', 'partial', 'noEvidence', 'needsFact', 'unanswered', 'met', 'na']

export interface CheckResult {
  check: Check
  status: Status
  legal: boolean
  sanctions: Sanction[]
  current: string
  required: string
  reason: string
  missing: string[]
  priority: number
  priorityName: '긴급' | '높음' | '보통' | '낮음' | '-'
  frameworks: FrameworkId[]
  evidenceIds: string[]
  findings: Finding[]
  /** 답변이 마지막으로 바뀐 날(YYYY-MM-DD) */
  answeredAt?: string
  /** 답한 지 1년이 넘어 다시 확인해야 하는 답변(인증 사후·갱신심사는 매년) */
  stale: boolean
}
export interface ObligationResult {
  id: string
  title: string
  status: 'required' | 'notRequired' | 'verify'
  text: string
  basis: string
  missing: string[]
}
export interface FrameworkResult {
  id: FrameworkId
  title: string
  counts: Record<Status, number>
  total: number
  applicable: number
  requirements: { id: string; title: string; group: string; status: Status; checks: string[] }[]
}
export interface FlowIssue {
  flowId: string
  name: string
  issue: string
  fix: string
  basis: string
}
export interface Assessment {
  targets: Target[]
  checks: CheckResult[]
  obligations: ObligationResult[]
  frameworks: FrameworkResult[]
  flowIssues: FlowIssue[]
  counts: Record<Status, number>
  readiness: number
  start: StartGuide
}
/** 처음 쓰는 사람이 어디부터 답할지: 판정을 많이 여는 상황 질문, 우선 답할 점검, 영역별 진행률 */
export interface StartGuide {
  facts: { id: string; label: string; checks: number; obligations: number }[]
  checks: string[]
  domains: { domain: string; applicable: number; answered: number }[]
}

export function inScope(c: Check, targets: Target[]): FrameworkId[] {
  const out: FrameworkId[] = []
  if (targets.includes('pipa') && c.map.pipa.length) out.push('pipa')
  if (c.map.ismsp.some((id) => ismsScope(id, targets))) out.push('ismsp')
  if (targets.includes('iso') && c.map.iso.length) out.push('iso')
  return out
}

/** ISMS 인증은 1·2영역 80개, ISMS-P는 3영역까지 101개(인증 고시 제23조①) */
function ismsScope(id: string, targets: Target[]): boolean {
  return targets.includes('ismsp') || (targets.includes('isms') && !id.startsWith('3.'))
}

/** 답한 날(한국 시간)과 1년 경과 여부. 값이 없거나 해당 없는 점검은 재확인 대상이 아닙니다. */
function answerAge(answer: Answer | undefined, status: Status, today: string): { answeredAt?: string; stale: boolean } {
  if (!answer || !isoTime(answer.at)) return { stale: false }
  const answeredAt = seoulDay(new Date(answer.at))
  const yearLater = `${Number(answeredAt.slice(0, 4)) + 1}${answeredAt.slice(4)}`
  return { answeredAt, stale: answer.value !== undefined && status !== 'na' && status !== 'needsFact' && today > yearLater }
}

export function assess(catalog: Catalog, data: WorkspaceData, ws: Workspace, today: string): Assessment {
  const { facts, targets } = data.profile
  const named = catalog.conditions
  const book = loadLaw(catalog)
  const validEvidence = new Map<string, string[]>()
  for (const e of data.evidence) {
    const s = ws.evidenceState(e, today).state
    if (s !== 'valid' && s !== 'expiring') continue
    for (const c of e.checks) validEvidence.set(c, [...(validEvidence.get(c) ?? []), e.id])
  }

  const checks: CheckResult[] = []
  for (const check of catalog.checks) {
    const frameworks = inScope(check, targets)
    if (!frameworks.length) continue
    const legalValue = check.legal === undefined ? false : check.legal === true ? true : evaluate(check.legal, facts, named)
    const legal = legalValue === true && check.map.pipa.length > 0
    const r = judge(catalog, check, data, validEvidence.get(check.id) ?? [])
    const failing = data.findings.filter((f) => f.status === 'fail' && f.checks.includes(check.id))
    if (failing.length && (r.status === 'met' || r.status === 'noEvidence')) {
      r.status = 'conflict'
      r.reason = `충족한다고 답했지만 기술 점검에서 ${failing.length}건이 발견됐습니다.`
    }
    const { priority, priorityName } = prioritize(check, r.status, legal)
    checks.push({
      check, ...r, legal, frameworks, priority, priorityName,
      sanctions: legal ? sanctionsFor(book, check.map.pipa) : [],
      evidenceIds: validEvidence.get(check.id) ?? [], findings: failing,
      ...answerAge(data.answers[check.id], r.status, today),
    })
  }
  checks.sort((a, b) => b.priority - a.priority)

  const byId = new Map(checks.map((c) => [c.check.id, c]))
  const frameworkResults: FrameworkResult[] = []
  for (const fw of catalog.frameworks) {
    if (fw.id === 'ismsp' ? !targets.includes('isms') && !targets.includes('ismsp') : !targets.includes(fw.id)) continue
    const requirements = fw.requirements
      .filter((r) => fw.id !== 'ismsp' || ismsScope(r.id, targets))
      .map((r) => {
        const linked = [...byId.values()].filter((c) => c.check.map[fw.id].includes(r.id))
        const active = linked.filter((c) => c.status !== 'na')
        const status = active.length ? worst(active.map((c) => c.status)) : linked.length ? 'na' : 'unanswered'
        return { ...r, status, checks: linked.map((c) => c.check.id) }
      })
    const counts = tally(requirements.map((r) => r.status))
    frameworkResults.push({
      id: fw.id,
      title: fw.id === 'ismsp' && !targets.includes('ismsp') ? 'ISMS 인증기준' : fw.title,
      counts, total: requirements.length, applicable: requirements.length - counts.na, requirements,
    })
  }

  const counts = tally(checks.map((c) => c.status))
  const applicable = checks.length - counts.na
  const obligations = catalog.obligations.map((o) => judgeObligation(catalog, o, data))
  return {
    targets, checks, frameworks: frameworkResults, counts,
    readiness: applicable ? Math.round((counts.met / applicable) * 100) : 0,
    obligations,
    flowIssues: data.flows.flatMap((f) => flowIssues(f, data)),
    start: startGuide(catalog, checks, obligations),
  }
}

function startGuide(catalog: Catalog, checks: CheckResult[], obligations: ObligationResult[]): StartGuide {
  const need = new Map<string, { checks: number; obligations: number }>()
  const bump = (id: string, k: 'checks' | 'obligations') => { const n = need.get(id) ?? { checks: 0, obligations: 0 }; n[k]++; need.set(id, n) }
  for (const c of checks) if (c.status === 'needsFact') c.missing.forEach((id) => bump(id, 'checks'))
  for (const o of obligations) if (o.status === 'verify') o.missing.forEach((id) => bump(id, 'obligations'))
  const facts = [...need].map(([id, n]) => ({ id, label: catalog.facts.get(id)!.label, ...n }))
    .sort((a, b) => b.obligations * 5 + b.checks - (a.obligations * 5 + a.checks))
  const sev = { high: 0, med: 1, low: 2 }
  const quick = { S: 0, M: 1, L: 2 }
  const open = checks.filter((c) => c.status === 'unanswered')
    .sort((a, b) => Number(b.legal) - Number(a.legal) || sev[a.check.severity] - sev[b.check.severity] || quick[a.check.effort] - quick[b.check.effort])
  const domains = new Map<string, { applicable: number; answered: number }>()
  for (const c of checks) {
    if (c.status === 'na') continue
    const d = domains.get(c.check.domain) ?? { applicable: 0, answered: 0 }
    d.applicable++
    if (c.status !== 'unanswered' && c.status !== 'needsFact') d.answered++
    domains.set(c.check.domain, d)
  }
  return { facts, checks: open.slice(0, 20).map((c) => c.check.id), domains: [...domains].map(([domain, d]) => ({ domain, ...d })) }
}

type Judged = Pick<CheckResult, 'status' | 'current' | 'required' | 'reason' | 'missing'>

function judge(catalog: Catalog, check: Check, data: WorkspaceData, evidence: string[]): Judged {
  const { facts } = data.profile
  const named = catalog.conditions
  const answer = data.answers[check.id]
  const required = check.need
  const label = (ids: string[]) => ids.map((id) => catalog.facts.get(id)!.label).join(', ')

  const applies = check.when ? evaluate(check.when, facts, named) : true
  if (applies === false) return { status: 'na', current: '-', required, reason: '입력한 상황에는 적용되지 않습니다.', missing: [] }
  if (answer?.value === 'na') {
    return answer.note.trim()
      ? { status: 'na', current: '해당 없음', required, reason: `제외 사유: ${answer.note}`, missing: [] }
      : { status: 'gap', current: '해당 없음(사유 없음)', required, reason: '제외하려면 사유를 적어야 합니다.', missing: [] }
  }

  const proven = (j: Omit<Judged, 'status'>): Judged =>
    evidence.length ? { ...j, status: 'met' } : { ...j, status: 'noEvidence', reason: '충족한다고 답했지만 유효한 증적이 연결되지 않았습니다.' }

  if (check.type === 'number') {
    const unit = check.unit ?? ''
    const limit = (r: NonNullable<Check['rules']>[number]) => (r.gte !== undefined ? `${r.gte}${unit} 이상` : `${r.lte}${unit} 이하`)
    const satisfies = (r: NonNullable<Check['rules']>[number], v: number) => (r.gte === undefined || v >= r.gte) && (r.lte === undefined || (v > 0 && v <= r.lte))
    // 앞선 규칙의 적용 여부를 모르면 뒤 규칙도 후보입니다. 확실히 적용되는 규칙에서 멈춥니다.
    const candidates: NonNullable<Check['rules']> = []
    const missing: string[] = []
    for (const r of check.rules!) {
      const v = r.when ? evaluate(r.when, facts, named) : true
      if (v === false) continue
      candidates.push(r)
      if (v === true) break
      missing.push(...missingFacts(r.when!, facts, named))
    }
    const need = `${required}: ${candidates.map(limit).join(' 또는 ')} — ${candidates.map((r) => r.basis).join(' / ')}`
    const base = { required: need, current: typeof answer?.value === 'number' ? `${answer.value}${unit}` : '모름', missing: [...new Set(missing)] }
    if (applies === 'unknown') return { ...base, status: 'needsFact', reason: `적용 여부를 정하려면 필요: ${label(missingFacts(check.when!, facts, named))}`, missing: missingFacts(check.when!, facts, named) }
    if (typeof answer?.value !== 'number') return { ...base, status: 'unanswered', reason: '현재 값을 입력하세요.' }
    const value = answer.value
    const ok = candidates.map((r) => satisfies(r, value))
    if (ok.every(Boolean)) return proven({ ...base, reason: '기준을 충족합니다.', missing: [] })
    if (ok.every((x) => !x)) return { ...base, status: 'gap', reason: `현재 ${base.current}, 필요 ${candidates.map(limit).join(' 또는 ')}입니다.` }
    return { ...base, status: 'needsFact', reason: `적용 기준을 정하려면 필요: ${label(base.missing)}` }
  }

  const names = { yes: '예', partial: '일부', no: '아니오' } as const
  const v = answer?.value as keyof typeof names | undefined
  const base = { current: v ? names[v] : '모름', required, missing: [] as string[] }
  if (applies === 'unknown') {
    const missing = missingFacts(check.when!, facts, named)
    return { ...base, status: 'needsFact', reason: `적용 여부를 정하려면 필요: ${label(missing)}`, missing }
  }
  if (!v) return { ...base, status: 'unanswered', reason: '아직 답하지 않았습니다.' }
  const note = answer!.note ? ` 메모: ${answer!.note}` : ''
  if (v === 'no') return { ...base, status: 'gap', reason: `요구사항을 이행하지 않고 있습니다.${note}` }
  if (v === 'partial') return { ...base, status: 'partial', reason: `일부만 이행하고 있습니다.${note}` }
  return proven({ ...base, reason: '기준을 충족합니다.' })
}

function judgeObligation(catalog: Catalog, o: Obligation, data: WorkspaceData): ObligationResult {
  const { facts } = data.profile
  const base = { id: o.id, title: o.title, basis: o.basis, missing: [] as string[] }
  if (o.verifyWhen && evaluate(o.verifyWhen, facts, catalog.conditions) === true) return { ...base, status: 'verify', text: o.verify ?? '' }
  const v = evaluate(o.when, facts, catalog.conditions)
  if (v === 'unknown') {
    const missing = missingFacts(o.when, facts, catalog.conditions)
    return { ...base, status: 'verify', missing, text: `판정에 필요한 값: ${missing.map((m) => catalog.facts.get(m)!.label).join(', ')}` }
  }
  if (v && o.draft) return { ...base, status: 'verify', text: o.required }
  return v ? { ...base, status: 'required', text: o.required } : { ...base, status: 'notRequired', text: o.otherwise }
}

function prioritize(check: Check, status: Status, legal: boolean): Pick<CheckResult, 'priority' | 'priorityName'> {
  if (status === 'met' || status === 'na') return { priority: 0, priorityName: '-' }
  const state = { gap: 40, conflict: 40, partial: 25, noEvidence: 12, needsFact: 15, unanswered: 15 }[status]
  const sev = { high: 30, med: 18, low: 8 }[check.severity]
  const quick = { S: 4, M: 2, L: 0 }[check.effort]
  const priority = state + sev + (legal ? 20 : 0) + quick
  return { priority, priorityName: priority >= 85 ? '긴급' : priority >= 65 ? '높음' : priority >= 45 ? '보통' : '낮음' }
}

/** 처리 흐름 자체의 누락과, 조직 상황 입력과의 모순을 찾습니다. */
function flowIssues(f: Flow, data: WorkspaceData): FlowIssue[] {
  const { facts } = data.profile
  const out: FlowIssue[] = []
  const add = (issue: string, fix: string, basis: string) => out.push({ flowId: f.id, name: f.name, issue, fix, basis })
  if (!f.purpose) add('처리 목적이 없습니다', '구체적인 처리 목적을 적으세요.', '개인정보 보호법 제3조①, 제30조①1')
  if (!f.items) add('처리 항목이 없습니다', '수집·생성하는 개인정보 항목을 모두 적으세요.', '시행령 제31조①1')
  if (!f.legalBasis) add('처리 근거가 없습니다', '동의·법령·계약 이행 등 제15조① 근거를 지정하세요.', '개인정보 보호법 제15조①')
  if (!f.retention) add('보유기간이 없습니다', '목적 달성 또는 법정 보존기간 기준으로 정하세요.', '개인정보 보호법 제21조①, 제30조①2')
  if (!f.destruction) add('파기 방법이 없습니다', '복구할 수 없는 파기 절차·방법을 정하세요.', '개인정보 보호법 제21조②, 제30조①3의2')
  if (/주민(등록)?번호/.test(f.items)) {
    if (!/법|시행령|규칙/.test(f.legalBasis)) add('주민등록번호의 법령 근거가 확인되지 않습니다', '근거 법령과 조항을 적고, 없으면 처리를 중단하고 파기하세요. 동의만으로는 처리할 수 없습니다.', '개인정보 보호법 제24조의2①')
    if (facts.rrn === false) add('조직 상황에는 주민등록번호를 처리하지 않는다고 되어 있습니다', '둘 중 맞는 쪽으로 고치세요.', '입력 모순')
  }
  if (/여권번호|운전면허|외국인등록번호/.test(f.items) && facts.uniqueId === false) add('조직 상황에는 고유식별정보를 처리하지 않는다고 되어 있습니다', '둘 중 맞는 쪽으로 고치세요.', '입력 모순')
  const has = { thirdParty: !!f.thirdParties || f.provisions.length > 0, outsourcing: !!f.processors, overseas: !!f.overseas || f.transfers.length > 0 }
  for (const [fact, label] of [['thirdParty', '제3자 제공'], ['outsourcing', '처리 위탁'], ['overseas', '국외 이전']] as const) {
    if (has[fact] && facts[fact] === false) add(`조직 상황에는 ${label}이(가) 없다고 되어 있습니다`, '둘 중 맞는 쪽으로 고치세요.', '입력 모순')
  }
  if (f.overseas && !f.transfers.length) add('국외 이전을 한 줄로만 적었습니다', '이전받는 자별로 항목, 국가, 시기·방법, 받는 자와 연락처, 목적·보유기간, 거부 방법을 나눠 적으세요. 처리방침과 동의 고지에 그대로 쓰입니다.', '개인정보 보호법 제28조의8②, 제30조①')
  f.transfers.forEach((x, i) => {
    const need: [keyof Transfer, string][] = [['basis', '이전 근거'], ['items', '이전 항목'], ['country', '국가'], ['timing', '시기'], ['method', '방법'], ['recipient', '받는 자'], ['contact', '받는 자 연락처'], ['purpose', '이용 목적'], ['retention', '보유·이용 기간'], ['refusal', '거부 방법·절차·효과']]
    const missing = need.filter(([k]) => !x[k]).map(([, l]) => l)
    if (missing.length) add(`국외 이전 ${i + 1}(${x.recipient || x.country || '받는 자 미기재'})에 ${missing.join(', ')}이(가) 없습니다`, x.basis === 'consent' ? '별도 동의를 받기 전에 모두 알려야 합니다.' : '처리방침에 공개하거나 정보주체에게 알려야 합니다.', x.basis === 'consent' ? '개인정보 보호법 제28조의8②' : '개인정보 보호법 제28조의8①3, 제30조①, 시행령 제31조①2')
  })
  if (f.thirdParties && !f.provisions.length) add('제3자 제공을 한 줄로만 적었습니다', '제공받는 자별로 목적, 항목, 보유·이용 기간, 제공 근거를 나눠 적으세요.', '개인정보 보호법 제17조②, 제30조①3')
  f.provisions.forEach((x, i) => {
    const need: [keyof Provision, string][] = [['basis', '제공 근거'], ['recipient', '제공받는 자'], ['purpose', '이용 목적'], ['items', '제공 항목'], ['retention', '보유·이용 기간']]
    const missing = need.filter(([k]) => !x[k]).map(([, l]) => l)
    if (missing.length) add(`제3자 제공 ${i + 1}(${x.recipient || '받는 자 미기재'})에 ${missing.join(', ')}이(가) 없습니다`, '동의를 받을 때와 처리방침에 알려야 하는 사항입니다.', '개인정보 보호법 제17조②, 제30조①3')
  })
  return out
}

/** 가장 나쁜 상태. 빈 목록은 미응답으로 봅니다. */
export function worst(s: Status[]): Status {
  return order.find((o) => s.includes(o)) ?? 'unanswered'
}
function tally(s: Status[]): Record<Status, number> {
  const out = Object.fromEntries(order.map((o) => [o, 0])) as Record<Status, number>
  for (const x of s) out[x]++
  return out
}
