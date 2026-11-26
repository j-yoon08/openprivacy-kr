import { assess, statusNames } from './assess.ts'
import type { Catalog } from './catalog.ts'
import { loadLaw, roleNames, type LawBook, type Provision, type Topic } from './law.ts'
import type { Workspace } from './workspace.ts'

export type Tier = 'direct' | 'always' | 'related' | 'confirm' | 'rest'
export const tierNames: Record<Tier, string> = { direct: '직접 관련', always: '항상 확인', related: '함께 볼 조문', confirm: '확인 필요', rest: '나머지' }
/** 주제별 답. 답하지 않은 주제는 모름입니다. */
export type TopicAnswers = Record<string, 'yes' | 'no'>
export interface ReviewItem { id: string; tier: Tier; reasons: string[]; score: number }
export interface Review {
  topics: { id: string; title: string; matched: string[]; ask: string[] }[]
  /** 아직 예·아니오를 정하지 않은 주제 */
  open: string[]
  /** 글에 낱말이 있지만 아니오라고 답한 주제 */
  overruled: { title: string; matched: string[] }[]
  items: ReviewItem[]
  checks: string[]
}

function matchKeyword(text: string, k: string): boolean {
  // 영문 약어는 단어 경계를 확인하고(email 속 ai 제외), 한글은 띄어쓰기를 무시합니다
  if (/^[\x21-\x7e]+$/.test(k)) return new RegExp(`(?<![A-Za-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9])`, 'i').test(text)
  return text.replace(/\s/g, '').includes(k.replace(/\s/g, ''))
}

const stop = new Set(['개인', '인정', '정보', '처리', '리자', '하여', '하는', '에는', '에서', '으로', '경우', '니다', '합니', '했다', '하고', '습니', '있다', '있는', '대한', '관한'])
function grams(s: string): string[] {
  const out: string[] = []
  for (const w of s.toLowerCase().split(/[^0-9a-z가-힣]+/)) for (let i = 0; i + 2 <= w.length; i++) if (!stop.has(w.slice(i, i + 2))) out.push(w.slice(i, i + 2))
  return out
}

/** 글자 두 개 단위 BM25. 같은 입력에는 언제나 같은 결과가 나옵니다. */
function similarity(book: LawBook, text: string): Map<string, number> {
  const docs = book.provisions.filter((p) => p.kind !== 'addendum').map((p) => ({ id: p.id, g: grams(`${p.title} ${p.title} ${p.text || p.upcoming?.text}`) }))
  const avg = docs.reduce((n, d) => n + d.g.length, 0) / docs.length
  const df = new Map<string, number>()
  for (const d of docs) for (const g of new Set(d.g)) df.set(g, (df.get(g) ?? 0) + 1)
  const q = new Set(grams(text))
  const out = new Map<string, number>()
  for (const d of docs) {
    const tf = new Map<string, number>()
    for (const g of d.g) if (q.has(g)) tf.set(g, (tf.get(g) ?? 0) + 1)
    let s = 0
    for (const [g, n] of tf) s += Math.log(1 + (docs.length - df.get(g)! + 0.5) / (df.get(g)! + 0.5)) * ((n * 2.2) / (n + 1.2 * (0.25 + (0.75 * d.g.length) / avg)))
    if (s > 0) out.set(d.id, s)
  }
  return out
}

/**
 * 모든 조문을 다섯 묶음으로 나눕니다. 어떤 조문도 결과에서 빠지지 않습니다.
 * 점검·상황 조문은 관련 주제를 모두 아니오라고 답해야만 "나머지"가 됩니다. 글의 표현 때문에 조문이 사라지지 않게 하려는 규칙입니다.
 */
export function reviewSituation(book: LawBook, text: string, answers: TopicAnswers = {}): Review {
  const matches = book.topics.map((t) => ({ topic: t, matched: t.keywords.filter((k) => matchKeyword(text, k)) }))
  const topics = matches.filter(({ topic, matched }) => answers[topic.id] !== 'no' && (matched.length || answers[topic.id] === 'yes'))
  const unanswered = matches.filter(({ topic, matched }) => !answers[topic.id] && !matched.length).map((m) => m.topic)
  const reasons = new Map<string, { tier: Tier; why: Set<string>; score: number }>()
  const rank: Tier[] = ['direct', 'always', 'related', 'confirm', 'rest']
  const add = (id: string, tier: Tier, why: string, score = 0) => {
    const cur = reasons.get(id) ?? { tier, why: new Set<string>(), score: 0 }
    if (rank.indexOf(tier) < rank.indexOf(cur.tier)) { cur.tier = tier; cur.why.clear() }
    if (cur.tier === tier) cur.why.add(why)
    cur.score = Math.max(cur.score, score)
    reasons.set(id, cur)
  }
  const label = (t: Topic, m: string[]) => `주제 "${t.title}"${m.length ? ` (${m.join(', ')})` : ' (예라고 답함)'}`
  for (const { topic, matched } of topics) for (const id of topic.articles) add(id, 'direct', label(topic, matched), 100 + matched.length)
  // 글에 조문 번호를 직접 적은 경우. "시행령"·"기준"이 앞에 있으면 그 조문입니다.
  for (const m of text.matchAll(/(시행령|영|안전성 확보조치 기준|기준)?\s?(제\d+조(?:의\d+)?)/g)) {
    const id = `${m[1] ? (m[1].endsWith('기준') ? '기준 ' : '영 ') : ''}${m[2]}`
    if (book.byId.has(id)) add(id, 'direct', '글에 조문 번호가 있음', 200)
  }
  for (const p of book.provisions) if (p.role === 'always') add(p.id, 'always', p.why)
  for (const t of unanswered) for (const id of t.articles) add(id, 'confirm', `아직 답하지 않음: ${t.q}`)
  const scores = similarity(book, text)
  const top = [...scores].sort((a, b) => b[1] - a[1])
  const best = top[0]?.[1] ?? 0
  for (const [id, s] of top.slice(0, 20)) if (s >= best * 0.45 && s > 4) add(id, 'related', '글과 표현이 비슷함', s)
  for (const [id, r] of [...reasons]) {
    if (r.tier !== 'direct') continue
    const p = book.byId.get(id)!
    for (const x of p.implementedBy) add(x, 'related', `${id}의 세부 규정`, 20)
    for (const x of p.refs) add(x, 'related', `${id}에서 인용`, 10)
    for (const s of p.sanctions) add(s.article, 'related', `${id} 위반 제재`, 15)
  }
  for (const [id, r] of [...reasons]) {
    if (r.tier === 'rest' || r.tier === 'confirm' || book.byId.get(id)!.source !== 'decree') continue
    for (const x of book.byId.get(id)!.implementedBy) add(x, 'related', `${id}의 별표·세부 기준`, 8)
  }
  const items = book.provisions.map((p): ReviewItem => {
    const r = reasons.get(p.id)
    return r ? { id: p.id, tier: r.tier, reasons: [...r.why], score: r.score } : { id: p.id, tier: 'rest', reasons: [p.why], score: scores.get(p.id) ?? 0 }
  })
  const position = new Map(book.provisions.map((p, i) => [p.id, i]))
  items.sort((a, b) => rank.indexOf(a.tier) - rank.indexOf(b.tier) || (a.tier === 'related' ? b.score - a.score : 0) || position.get(a.id)! - position.get(b.id)!)
  return {
    topics: topics.map(({ topic, matched }) => ({ id: topic.id, title: topic.title, matched, ask: topic.ask })),
    open: unanswered.map((t) => t.id),
    overruled: matches.filter(({ topic, matched }) => answers[topic.id] === 'no' && matched.length).map(({ topic, matched }) => ({ title: topic.title, matched })),
    items,
    checks: [...new Set(items.filter((i) => i.tier === 'direct').flatMap((i) => book.byId.get(i.id)!.checks))],
  }
}

export function renderReview(catalog: Catalog, ws: Workspace, input: { title: string; text: string; topics: TopicAnswers; conclusion?: string }, today: string, full: boolean): string {
  const book = loadLaw(catalog)
  const r = reviewSituation(book, input.text, input.topics)
  const a = assess(catalog, ws.load(), ws, today)
  const of = (t: Tier) => r.items.filter((i) => i.tier === t).map((i) => ({ i, p: book.byId.get(i.id)! }))
  const quote = (s: string) => s.split('\n').map((l) => `> ${l.replace(/[<>]/g, (c) => `\\${c}`)}`).join('\n>\n')
  const block = ({ i, p }: { i: ReviewItem; p: Provision }, body: boolean) => [
    `### ${heading(p)}`, `- 이유: ${i.reasons.join(', ')}`,
    ...(p.pending ? [`- 시행 시점 주의: ${p.pending}`] : []),
    ...(p.implementedBy.length ? [`- 세부 규정: ${p.implementedBy.join(', ')}`] : []),
    ...(p.sanctions.length ? [`- 제재: ${p.sanctions.map((s) => `${s.article} ${s.item}`).join(', ')}`] : []),
    ...(body && p.text ? [quote(p.text)] : []),
    ...(body && p.upcoming ? [`**시행 예정(${p.upcoming.effective})**`, quote(p.upcoming.text)] : []),
  ].join('\n\n').replace(/\n\n- /g, '\n- ')
  const checks = a.checks.filter((c) => r.checks.includes(c.check.id) && c.status !== 'na')
  return [
    `# 상황 검토서: ${input.title}`,
    `- 작성일: ${today}\n- 적용 원문: ${book.texts.map((t) => `${t.title}(${t.version}, 시행 ${t.effective})`).join(', ')}`,
    '> 주제 답변과 낱말로 조문을 분류한 검토 보조 자료이며 법률 판단이 아닙니다. 글에서 주제를 놓칠 수 있으니 "확인 필요" 질문에 모두 답한 뒤 사용하세요.',
    `## 상황\n\n${input.text.replace(/[<>]/g, (c) => `\\${c}`)}`,
    ...(input.conclusion ? [`## 검토 의견\n\n${input.conclusion.replace(/[<>]/g, (c) => `\\${c}`)}`] : ['## 검토 의견\n\n【작성 필요: 검토자 의견】']),
    `## 찾은 주제와 확인할 질문\n\n${r.topics.map((t) => `- **${t.title}**${t.matched.length ? ` (${t.matched.join(', ')})` : ''}\n${t.ask.map((q) => `  - [ ] ${q}`).join('\n')}`).join('\n') || '찾은 주제가 없습니다. 주제를 직접 고르거나 상황을 더 구체적으로 적으세요.'}`,
    `## 아직 답하지 않은 질문 (${r.open.length}개)\n\n${r.open.map((id) => `- [ ] ${book.topics.find((t) => t.id === id)!.q}`).join('\n') || '없음'}${r.overruled.length ? `\n\n글에 낱말이 있지만 아니오로 답한 주제: ${r.overruled.map((o) => `${o.title}(${o.matched.join(', ')})`).join(', ')}` : ''}`,
    `## 우리 조직의 관련 점검 상태\n\n${checks.map((c) => `- [${statusNames[c.status]}] ${c.required}`).join('\n') || '없음'}`,
    ...(['direct', 'always', 'related', 'confirm'] as const).map((t) => `## ${tierNames[t]} (${of(t).length}개)\n\n${of(t).map((x) => block(x, t !== 'confirm' || full)).join('\n\n')}`),
    `## 나머지 (${of('rest').length}개)\n\n${full ? of('rest').map((x) => block(x, true)).join('\n\n') : of('rest').map(({ p }) => `- ${heading(p)} — ${p.role === 'reference' ? p.why : `${roleNames[p.role]}: ${p.why}`}`).join('\n')}`,
    `합계 ${r.items.length}개: 현행 조문·시행 예정 조문·별표·부칙 전체를 분류했습니다.`,
  ].join('\n\n') + '\n'
}

export function heading(p: Provision): string {
  if (p.kind === 'addendum') return p.id
  const name = { law: '법', decree: '', safeguard: '' }[p.source]
  return `${name ? `${name} ` : ''}${p.id} ${p.title}${p.text ? '' : ' (시행 예정)'}`
}
