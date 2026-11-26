import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { z } from 'zod'
import { conditionSchema, refs, type Condition, type Conditions } from './condition.ts'

export const frameworkIds = ['pipa', 'ismsp', 'iso'] as const
export type FrameworkId = (typeof frameworkIds)[number]

const factSchema = z.strictObject({
  id: z.string(),
  label: z.string(),
  type: z.enum(['text', 'number', 'bool', 'choice']),
  unit: z.string().optional(),
  help: z.string().optional(),
  options: z.record(z.string(), z.string()).optional(),
})
const ruleSchema = z.strictObject({
  when: conditionSchema.optional(),
  gte: z.number().optional(),
  lte: z.number().optional(),
  basis: z.string(),
})
const checkSchema = z
  .strictObject({
    id: z.string().regex(/^[a-z0-9-]+$/),
    need: z.string(),
    when: conditionSchema.optional(),
    legal: z.union([z.literal(true), conditionSchema]).optional(),
    severity: z.enum(['high', 'med', 'low']),
    effort: z.enum(['S', 'M', 'L']),
    type: z.enum(['level', 'number']).default('level'),
    unit: z.string().optional(),
    rules: z.array(ruleSchema).optional(),
    fix: z.array(z.string()).min(1),
    evidence: z.array(z.string()).min(1),
    map: z.strictObject({
      pipa: z.array(z.string()).default([]),
      ismsp: z.array(z.string()).default([]),
      iso: z.array(z.string()).default([]),
    }),
  })
  .refine((c) => (c.type === 'number') === !!c.rules, '숫자형 점검에는 rules가 필요합니다')
const measureFile = z.strictObject({ domain: z.string(), checks: z.array(checkSchema) })
const frameworkSchema = z.strictObject({
  id: z.enum(frameworkIds),
  title: z.string(),
  source: z.string(),
  note: z.string(),
  requirements: z.array(
    z.strictObject({
      id: z.string(),
      title: z.string(),
      group: z.string(),
      /** 기준 원문(공개 고시만). 저작권이 있는 표준은 비워 둡니다. */
      text: z.string().optional(),
      /** 원문을 확인할 요건으로 나눈 것과, 각 요건을 확인하는 점검 */
      points: z.array(z.strictObject({ text: z.string().min(1), checks: z.array(z.string()).min(1) })).optional(),
    }),
  ),
})
const obligationSchema = z.strictObject({
  id: z.string(),
  title: z.string(),
  when: conditionSchema,
  verifyWhen: conditionSchema.optional(),
  verify: z.string().optional(),
  basis: z.string(),
  required: z.string(),
  otherwise: z.string(),
})
const sourcesSchema = z.strictObject({
  checkedOn: z.string(),
  sources: z.array(z.strictObject({ id: z.string(), title: z.string(), version: z.string(), effective: z.string(), url: z.url() })),
  watch: z.array(z.strictObject({ title: z.string(), detail: z.string(), url: z.url() })),
})

export type Fact = z.infer<typeof factSchema>
export type Check = z.infer<typeof checkSchema> & { domain: string }
export type Framework = z.infer<typeof frameworkSchema>
export type Obligation = z.infer<typeof obligationSchema>
export interface Catalog {
  sources: z.infer<typeof sourcesSchema>
  factGroups: { title: string; facts: Fact[] }[]
  facts: Map<string, Fact>
  conditions: Conditions
  obligations: Obligation[]
  frameworks: Framework[]
  checks: Check[]
}

function packageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url))
  while (!existsSync(join(dir, 'catalog', 'sources.yaml'))) {
    const up = dirname(dir)
    if (up === dir) throw new Error('catalog 폴더를 찾지 못했습니다')
    dir = up
  }
  return dir
}
export const root = packageRoot()

export function loadCatalog(base = join(root, 'catalog')): Catalog {
  const read = (p: string): unknown => parse(readFileSync(join(base, p), 'utf8'))
  const yamlIn = (d: string) => readdirSync(join(base, d)).filter((f) => f.endsWith('.yaml')).sort()

  const { groups } = z.object({ groups: z.array(z.strictObject({ title: z.string(), facts: z.array(factSchema) })) }).parse(read('facts.yaml'))
  const facts = new Map(groups.flatMap((g) => g.facts).map((f) => [f.id, f]))
  const conditions = z.record(z.string(), conditionSchema).parse(read('conditions.yaml'))
  const obligations = z.array(obligationSchema).parse(read('obligations.yaml'))
  const frameworks = yamlIn('frameworks').map((f) => frameworkSchema.parse(read(`frameworks/${f}`)))
  frameworks.sort((a, b) => frameworkIds.indexOf(a.id) - frameworkIds.indexOf(b.id))
  const checks = yamlIn('measures').flatMap((f) => {
    const m = measureFile.parse(read(`measures/${f}`))
    return m.checks.map((c) => ({ ...c, domain: m.domain }))
  })
  const sources = sourcesSchema.parse(read('sources.yaml'))

  const problems: string[] = []
  const verify = (where: string, c: Condition) => {
    for (const r of refs(c)) {
      if (r.ref && !conditions[r.ref]) problems.push(`${where}: 없는 조건 ${r.ref}`)
      if (r.fact && !facts.has(r.fact)) problems.push(`${where}: 없는 상황 항목 ${r.fact}`)
    }
  }
  for (const [k, c] of Object.entries(conditions)) verify(k, c)
  for (const o of obligations) [o.when, o.verifyWhen].forEach((c) => c && verify(o.id, c))
  const seen = new Set<string>()
  for (const c of checks) {
    if (seen.has(c.id)) problems.push(`중복 점검 ID ${c.id}`)
    seen.add(c.id)
    if (c.when) verify(c.id, c.when)
    if (c.legal && c.legal !== true) verify(c.id, c.legal)
    for (const r of c.rules ?? []) if (r.when) verify(c.id, r.when)
    for (const fw of frameworks) {
      const ids = new Set(fw.requirements.map((r) => r.id))
      for (const m of c.map[fw.id]) if (!ids.has(m)) problems.push(`${c.id}: ${fw.id}에 없는 조항 ${m}`)
    }
  }
  const byId = new Map(checks.map((c) => [c.id, c]))
  for (const fw of frameworks)
    for (const r of fw.requirements)
      for (const pt of r.points ?? [])
        for (const id of pt.checks) {
          const c = byId.get(id)
          if (!c) problems.push(`${fw.id} ${r.id}: 없는 점검 ${id}`)
          else if (!c.map[fw.id].includes(r.id)) problems.push(`${fw.id} ${r.id}: 점검 ${id}의 map에 ${r.id}가 없습니다`)
        }
  const sourceIds = new Set(sources.sources.map((s) => s.id))
  for (const fw of frameworks) if (!sourceIds.has(fw.source)) problems.push(`${fw.id}: 없는 출처 ${fw.source}`)
  if (problems.length) throw new Error(`카탈로그 오류\n${problems.join('\n')}`)
  return { sources, factGroups: groups, facts, conditions, obligations, frameworks, checks }
}
