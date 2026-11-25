import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { z } from 'zod'
import { root, type Catalog } from './catalog.ts'

const textSchema = z.strictObject({
  id: z.enum(['law', 'decree', 'safeguard']),
  title: z.string(),
  fetchedOn: z.iso.date(),
  effective: z.iso.date(),
  version: z.string(),
  articles: z.array(z.strictObject({
    id: z.string(), chapter: z.string(), title: z.string(), text: z.string(), deleted: z.literal(true).optional(), pending: z.string().optional(),
    upcoming: z.strictObject({ effective: z.iso.date(), text: z.string() }).optional(),
  })),
  annexes: z.array(z.strictObject({ id: z.string(), title: z.string(), text: z.string() })),
  addenda: z.array(z.strictObject({ title: z.string(), text: z.string() })),
})
const rolesSchema = z.strictObject({
  always: z.record(z.string(), z.string()), situational: z.record(z.string(), z.string()),
  reference: z.record(z.string(), z.array(z.string())), decree: z.record(z.string(), z.array(z.string())),
})
const topicSchema = z.strictObject({ id: z.string(), title: z.string(), group: z.string(), q: z.string(), keywords: z.array(z.string()).min(1), articles: z.array(z.string()).min(1), ask: z.array(z.string()).min(1) })

export type Role = 'check' | 'always' | 'situational' | 'reference'
export const roleNames: Record<Role, string> = { check: '점검에 연결', always: '항상 확인', situational: '상황 발생 시', reference: '참고' }
export type Topic = z.infer<typeof topicSchema>
export interface Sanction { article: string; item: string; text: string; lead: string }
export interface Provision {
  id: string
  source: 'law' | 'decree' | 'safeguard'
  kind: 'article' | 'annex' | 'addendum'
  chapter: string
  title: string
  text: string
  role: Role
  why: string
  pending?: string
  upcoming?: { effective: string; text: string }
  /** 이 조문이 언급하는 조문 */
  refs: string[]
  /** 이 조문을 구체화하는 시행령·별표·기준 */
  implementedBy: string[]
  sanctions: Sanction[]
  checks: string[]
}
export interface LawBook {
  texts: { id: string; title: string; version: string; effective: string; fetchedOn: string }[]
  provisions: Provision[]
  byId: Map<string, Provision>
  topics: Topic[]
}

const art = /제\d+조(?:의\d+)?/g

/** "제15조부터 제18조까지"를 펼치고 조문 번호를 모읍니다. 「다른 법」의 조문은 제외합니다. */
export function articleRefs(text: string, order: string[]): string[] {
  const own = text.replace(/「(?!개인정보 보호법」)[^」]*」(?: 및 같은 법 시행령| 시행령)?(?: ?(?:제\d+조(?:의\d+)?(?:제\d+항)?(?:제\d+호)?(?:[가-힣]목)?(?: 또는 | 및 |ㆍ|, ?)?)+)?/g, '')
  const out = new Set<string>()
  for (const m of own.matchAll(/(제\d+조(?:의\d+)?)(?:제\d+항)?부터 (제\d+조(?:의\d+)?)(?:제\d+항)?까지/g)) {
    const [a, b] = [order.indexOf(m[1]!), order.indexOf(m[2]!)]
    if (a >= 0 && b >= a) order.slice(a, b + 1).forEach((x) => out.add(x))
  }
  for (const m of own.matchAll(art)) if (order.includes(m[0])) out.add(m[0])
  return [...out]
}

const penal = new Set(['제64조의2', '제70조', '제71조', '제72조', '제73조', '제75조'])

/** 제재 조문의 각 호에서 위반 조문을 뽑습니다. 준용을 설명하는 괄호는 위반 조문이 아니므로 뺍니다. */
export function extractSanctions(id: string, text: string, order: string[]): { target: string; sanction: Sanction }[] {
  const out: { target: string; sanction: Sanction }[] = []
  let para = ''
  let lead = ''
  for (const line of text.split('\n')) {
    const head = /^(?:제\d+조(?:의\d+)?\([^)]*\) ?)?([①-⑳])?/.exec(line)
    const item = /^(\d+(?:의\d+)?)\. /.exec(line)
    if (item) {
      // "…위반하여" 앞이 위반 조문입니다. 없으면 호 전체를 봅니다.
      const clean = line.replace(/\([^)]*준용[^)]*\)/g, '')
      const cut = clean.search(/위반|따르지|소홀히|따른 시정|를 받지/)
      for (const target of articleRefs(cut > 0 ? clean.slice(0, cut) : clean, order)) {
        out.push({ target, sanction: { article: id, item: `${para}${item[1]}호`, text: line, lead } })
      }
    } else if (head && (head[1] || /^제\d+조/.test(line))) {
      para = head[1] ? `${head[1]} ` : ''
      lead = line.replace(/^제\d+조(?:의\d+)?\([^)]*\) ?/, '').replace(/^[①-⑳] ?/, '')
    }
  }
  return out.filter((x) => x.target !== id)
}

let cached: LawBook | undefined
export function loadLaw(catalog: Catalog): LawBook {
  if (cached) return cached
  const base = join(root, 'catalog', 'law')
  const texts = (['law', 'decree', 'safeguard'] as const).map((f) => textSchema.parse(JSON.parse(readFileSync(join(base, `${f}.json`), 'utf8'))))
  const roles = rolesSchema.parse(parse(readFileSync(join(base, 'roles.yaml'), 'utf8')))
  const topics = z.array(topicSchema).parse(parse(readFileSync(join(base, 'topics.yaml'), 'utf8')))
  const lawOrder = texts[0]!.articles.map((a) => a.id)
  const checksOf = new Map<string, string[]>()
  for (const c of catalog.checks) for (const id of c.map.pipa) checksOf.set(id, [...(checksOf.get(id) ?? []), c.id])
  const referenceWhy = new Map(Object.entries(roles.reference).flatMap(([why, ids]) => ids.map((id) => [id, why] as const)))

  const provisions: Provision[] = []
  const problems: string[] = []
  const blank = { refs: [], implementedBy: [], sanctions: [] }
  for (const t of texts) {
    for (const a of t.articles) {
      if (a.deleted) continue
      let role: Role
      let why: string
      if (t.id === 'decree') { role = 'reference'; why = '시행령' } else {
        const hits = [checksOf.has(a.id), a.id in roles.always, a.id in roles.situational, referenceWhy.has(a.id)]
        if (hits.filter(Boolean).length !== 1) problems.push(`${a.id}: 역할이 ${hits.filter(Boolean).length}개입니다`)
        role = hits[0] ? 'check' : hits[1] ? 'always' : hits[2] ? 'situational' : 'reference'
        why = roles.always[a.id] ?? roles.situational[a.id] ?? referenceWhy.get(a.id) ?? '점검 항목으로 확인'
      }
      provisions.push({ id: a.id, source: t.id, kind: 'article', chapter: a.chapter, title: a.title, text: a.text, role, why, pending: a.pending, upcoming: a.upcoming, ...structuredClone(blank), checks: checksOf.get(a.id) ?? [] })
    }
    const p = { law: '', decree: '영 ', safeguard: '기준 ' }[t.id]
    for (const x of t.annexes) provisions.push({ id: `${p}${x.id}`, source: t.id, kind: 'annex', chapter: '별표', title: x.title, text: x.text, role: 'reference', why: '별표', ...structuredClone(blank), checks: [] })
    for (const x of t.addenda) provisions.push({ id: `${p}${x.title}`, source: t.id, kind: 'addendum', chapter: '부칙', title: x.title, text: x.text, role: 'reference', why: '부칙(시행일·경과조치)', ...structuredClone(blank), checks: [] })
  }
  const byId = new Map(provisions.map((p) => [p.id, p]))
  const need = (where: string, id: string) => { if (!byId.has(id)) problems.push(`${where}: 없는 조문 ${id}`) }
  for (const id of [...Object.keys(roles.always), ...Object.keys(roles.situational), ...referenceWhy.keys()]) need('roles', id)
  for (const t of topics) t.articles.forEach((id) => need(`topic ${t.id}`, id))
  const inTopic = new Set(topics.flatMap((t) => t.articles))
  for (const p of provisions) if ((p.role === 'check' || p.role === 'situational') && !inTopic.has(p.id)) problems.push(`${p.id}: 상황 주제에 없습니다`)
  if (byId.size !== provisions.length) problems.push('조문 ID가 겹칩니다')

  const implement = (target: string, by: string) => {
    const p = byId.get(target)
    if (p && target !== by && !p.implementedBy.includes(by)) p.implementedBy.push(by)
  }
  const prefixed = (source: Provision['source']) => texts.find((t) => t.id === source)!.articles.map((a) => a.id.replace(/^(영|기준) /, ''))
  for (const p of provisions) {
    if (p.kind === 'addendum') continue
    if (p.source === 'law') {
      p.refs = articleRefs(p.text || p.upcoming?.text || '', lawOrder).filter((id) => id !== p.id)
      continue
    }
    // 시행령·기준에서 "법 제N조"는 법률, 앞에 "법"이 없는 "제N조"는 자기 조문입니다
    const own = { decree: '영 ', safeguard: '기준 ' }[p.source]
    const lawParts = [...p.text.matchAll(/(?<![가-힣])법 (제\d+조(?:의\d+)?)/g)].map((m) => m[1]!)
    const decreeParts = p.source === 'safeguard' ? [...p.text.matchAll(/(?<![가-힣])영 (제\d+조(?:의\d+)?)/g)].map((m) => `영 ${m[1]}`) : []
    const selfText = p.text.replace(/(?<![가-힣])(?:법|영) 제\d+조(?:의\d+)?/g, '')
    const self = articleRefs(selfText, prefixed(p.source)).map((id) => `${own}${id}`).filter((id) => id !== p.id)
    const extra = roles.decree[p.id] ?? []
    if (p.source === 'decree' && p.kind === 'article' && !lawParts.length && !extra.length) problems.push(`${p.id}: 연결된 법률 조문이 없습니다`)
    p.refs = [...new Set([...lawParts, ...decreeParts, ...self, ...extra])].filter((id) => byId.has(id))
    if (p.kind === 'annex') self.forEach((id) => implement(id, p.id))
    else [...lawParts, ...extra, ...decreeParts].forEach((id) => implement(id, p.id))
  }
  for (const id of Object.keys(roles.decree)) need('roles.decree', id)
  // 안전성 확보조치 기준 전체는 법 제29조의 세부 기준입니다(기준 제1조)
  for (const p of provisions) if (p.source === 'safeguard' && p.kind === 'article' && p.role === 'check') implement('제29조', p.id)
  for (const id of penal) {
    const p = byId.get(id)!
    for (const { target, sanction } of extractSanctions(id, p.text, lawOrder)) byId.get(target)?.sanctions.push(sanction)
  }
  if (problems.length) throw new Error(`법령 데이터 오류\n${problems.join('\n')}`)
  cached = { texts: texts.map(({ id, title, version, effective, fetchedOn }) => ({ id, title, version, effective, fetchedOn })), provisions, byId, topics }
  return cached
}

/** 점검에 연결된 조문의 제재. 안전성 확보조치 기준 위반은 법 제29조 위반으로 이어집니다. */
export function sanctionsFor(book: LawBook, pipa: string[]): Sanction[] {
  const seen = new Set<string>()
  return pipa.flatMap((id) => book.byId.get(id.startsWith('기준') ? '제29조' : id)?.sanctions ?? []).filter((s) => {
    const k = `${s.article} ${s.item}`
    return seen.has(k) ? false : !!seen.add(k)
  })
}
