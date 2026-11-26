import { createHash, randomUUID } from 'node:crypto'
import { appendFileSync, closeSync, copyFileSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, renameSync, writeFileSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import { parse, stringify } from 'yaml'
import { z } from 'zod'
import { type Catalog } from './catalog.ts'

const date = z.iso.date()
const targetSchema = z.enum(['pipa', 'isms', 'ismsp', 'iso'])
export type Target = z.infer<typeof targetSchema>
export const targetNames: Record<Target, string> = { pipa: '개인정보 보호법', isms: 'ISMS', ismsp: 'ISMS-P', iso: 'ISO/IEC 27001' }

const profileSchema = z.strictObject({
  targets: z.array(targetSchema).min(1).default(['pipa', 'ismsp', 'iso']),
  facts: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
})
const answerSchema = z.strictObject({
  value: z.union([z.enum(['yes', 'partial', 'no', 'na']), z.number().nonnegative()]).optional(),
  note: z.string().default(''),
  owner: z.string().default(''),
  due: z.union([date, z.literal('')]).default(''),
  /** 값·메모·담당·기한이 마지막으로 바뀐 시각. 서버가 기록하며 입력값은 무시합니다. */
  at: z.string().optional(),
})
const answersSchema = z.record(z.string(), answerSchema)
const evidenceSchema = z.strictObject({
  id: z.string(),
  title: z.string().min(1),
  checks: z.array(z.string()).min(1),
  owner: z.string().default(''),
  collectedOn: date,
  validDays: z.number().int().positive().default(365),
  file: z.string().optional(),
  sha256: z.string().optional(),
  link: z.string().optional(),
})
const flowSchema = z.strictObject({
  id: z.string(),
  name: z.string().min(1),
  purpose: z.string().default(''),
  subjects: z.string().default(''),
  items: z.string().default(''),
  legalBasis: z.string().default(''),
  source: z.string().default(''),
  retention: z.string().default(''),
  thirdParties: z.string().default(''),
  processors: z.string().default(''),
  overseas: z.string().default(''),
  systems: z.string().default(''),
  destruction: z.string().default(''),
})
const score = z.number().int().min(1).max(5)
const riskSchema = z.strictObject({
  id: z.string(),
  asset: z.string().min(1),
  threat: z.string().min(1),
  likelihood: score,
  impact: score,
  treatment: z.enum(['mitigate', 'avoid', 'transfer', 'accept']).default('mitigate'),
  plan: z.string().default(''),
  owner: z.string().default(''),
  due: z.union([date, z.literal('')]).default(''),
  check: z.string().optional(),
})
const findingSchema = z.strictObject({
  scanner: z.string(),
  target: z.string(),
  rule: z.string(),
  status: z.enum(['pass', 'fail', 'unknown']),
  title: z.string(),
  detail: z.string().default(''),
  checks: z.array(z.string()).default([]),
  at: z.string(),
})

const reviewSchema = z.strictObject({
  id: z.string(),
  title: z.string().min(1),
  text: z.string().min(1),
  topics: z.record(z.string(), z.enum(['yes', 'no'])).default({}),
  conclusion: z.string().default(''),
  createdOn: date,
  lawVersion: z.string().default(''),
})

export type Profile = z.infer<typeof profileSchema>
export type Answer = z.infer<typeof answerSchema>
export type Evidence = z.infer<typeof evidenceSchema>
export type Flow = z.infer<typeof flowSchema>
export type Risk = z.infer<typeof riskSchema>
export type SavedReview = z.infer<typeof reviewSchema>
export type Finding = z.infer<typeof findingSchema>

export const collections = {
  profile: profileSchema,
  answers: answersSchema,
  evidence: z.array(evidenceSchema),
  flows: z.array(flowSchema),
  risks: z.array(riskSchema),
  findings: z.array(findingSchema),
  reviews: z.array(reviewSchema),
}
export type CollectionName = keyof typeof collections
export interface WorkspaceData {
  profile: Profile
  answers: Record<string, Answer>
  evidence: Evidence[]
  flows: Flow[]
  risks: Risk[]
  findings: Finding[]
  reviews: SavedReview[]
}
const empty: WorkspaceData = { profile: { targets: ['pipa', 'ismsp', 'iso'], facts: {} }, answers: {}, evidence: [], flows: [], risks: [], findings: [], reviews: [] }

export class InputError extends Error {}

export class Workspace {
  readonly dir: string
  readonly catalog: Catalog

  constructor(dir: string, catalog: Catalog) {
    this.dir = resolve(dir)
    this.catalog = catalog
  }

  get exists(): boolean {
    return existsSync(join(this.dir, 'profile.yaml'))
  }

  init(): void {
    mkdirSync(join(this.dir, 'evidence'), { recursive: true, mode: 0o700 })
    for (const name of Object.keys(collections) as CollectionName[]) {
      if (!existsSync(this.path(name))) this.write(name, empty[name])
    }
  }

  load(): WorkspaceData {
    if (!this.exists) throw new InputError(`작업 폴더가 없습니다: ${this.dir} (먼저 init을 실행하세요)`)
    const out: Record<string, unknown> = {}
    for (const name of Object.keys(collections) as CollectionName[]) {
      const raw: unknown = existsSync(this.path(name)) ? parse(readFileSync(this.path(name), 'utf8')) : empty[name]
      out[name] = this.validate(name, raw ?? empty[name])
    }
    return out as unknown as WorkspaceData
  }

  save(name: CollectionName, value: unknown): void {
    const valid = this.validate(name, value)
    if (name === 'answers') this.stampAnswers(valid as Record<string, Answer>)
    this.write(name, valid)
  }

  /** 바뀐 답변에 시각을 찍고 changes.jsonl에 덧붙입니다(심사 때 판단 이력 근거). */
  private stampAnswers(next: Record<string, Answer>): void {
    const prev = existsSync(this.path('answers')) ? (this.validate('answers', parse(readFileSync(this.path('answers'), 'utf8')) ?? {}) as Record<string, Answer>) : {}
    const now = new Date().toISOString()
    const same = (a?: Answer, b?: Answer) => !!a && !!b && a.value === b.value && a.note === b.note && a.owner === b.owner && a.due === b.due
    const log: string[] = []
    for (const [id, a] of Object.entries(next)) {
      const before = prev[id]
      if (same(before, a)) { if (before!.at) a.at = before!.at; else delete a.at; continue }
      a.at = now
      log.push(JSON.stringify({ at: now, check: id, from: before?.value ?? null, to: a.value ?? null, note: a.note, owner: a.owner }))
    }
    for (const id of Object.keys(prev)) if (!(id in next)) log.push(JSON.stringify({ at: now, check: id, from: prev[id]!.value ?? null, to: null, note: '답변 삭제', owner: '' }))
    if (log.length) appendFileSync(join(this.dir, 'changes.jsonl'), log.join('\n') + '\n', { mode: 0o600 })
  }

  private path(name: CollectionName): string {
    return join(this.dir, `${name}.yaml`)
  }

  private write(name: CollectionName, value: unknown): void {
    const tmp = join(this.dir, `.${name}.${randomUUID()}.tmp`)
    writeFileSync(tmp, stringify(value), { mode: 0o600 })
    renameSync(tmp, this.path(name))
  }

  private validate(name: CollectionName, raw: unknown): unknown {
    const parsed = collections[name].safeParse(raw)
    if (!parsed.success) throw new InputError(`${name} 형식 오류: ${z.prettifyError(parsed.error)}`)
    const checks = new Map(this.catalog.checks.map((c) => [c.id, c]))
    const known = (id: string) => {
      if (!checks.has(id)) throw new InputError(`${name}: 없는 점검 항목 ${id}`)
    }
    switch (name) {
      case 'profile':
        for (const [k, v] of Object.entries((parsed.data as Profile).facts)) this.validateFact(k, v)
        break
      case 'answers':
        for (const [id, a] of Object.entries(parsed.data as Record<string, Answer>)) {
          known(id)
          const numeric = checks.get(id)!.type === 'number'
          if (a.value === undefined || a.value === 'na') continue
          if (numeric !== (typeof a.value === 'number')) throw new InputError(`${id}: ${numeric ? '숫자로' : 'yes/partial/no/na로'} 답해야 합니다`)
        }
        break
      case 'evidence':
        for (const e of parsed.data as Evidence[]) {
          e.checks.forEach(known)
          if (e.file && e.file !== basename(e.file)) throw new InputError(`${e.id}: 증적 파일 이름에 경로를 쓸 수 없습니다`)
          if (e.link && !/^https?:\/\//.test(e.link)) throw new InputError(`${e.id}: 링크는 http(s)만 쓸 수 있습니다`)
        }
        break
      case 'risks':
        for (const r of parsed.data as Risk[]) if (r.check) known(r.check)
        break
      case 'findings':
        for (const f of parsed.data as Finding[]) f.checks.forEach(known)
        break
      case 'flows':
      case 'reviews':
        break
    }
    return parsed.data
  }

  private validateFact(id: string, v: unknown): void {
    const f = this.catalog.facts.get(id)
    if (!f) throw new InputError(`없는 상황 항목 ${id}`)
    const ok =
      f.type === 'number' ? typeof v === 'number' && v >= 0 : f.type === 'bool' ? typeof v === 'boolean' : typeof v === 'string' && (f.type !== 'choice' || v in f.options!)
    if (!ok) throw new InputError(`${f.label}: 값 형식이 맞지 않습니다`)
  }

  /** 증적을 작업 폴더로 복사하고 해시를 남깁니다. */
  addEvidence(meta: Omit<Evidence, 'id' | 'sha256' | 'file'>, source?: { path: string } | { name: string; bytes: Buffer }): Evidence {
    const list = this.load().evidence
    const id = `EV-${randomUUID().slice(0, 8)}`
    const item: Evidence = { ...meta, id }
    // 파일을 쓰기 전에 메타데이터를 먼저 검증해 고아 파일이 남지 않게 합니다
    this.validate('evidence', [...list, item])
    if (source) {
      const name = 'path' in source ? source.path : source.name
      const ext = extname(basename(name)).replace(/[^.A-Za-z0-9]/g, '').slice(0, 12)
      item.file = `${id}${ext}`
      const dest = join(this.dir, 'evidence', item.file)
      mkdirSync(join(this.dir, 'evidence'), { recursive: true, mode: 0o700 })
      if ('path' in source) copyFileSync(source.path, dest)
      else writeFileSync(dest, source.bytes, { mode: 0o600 })
      item.sha256 = sha256(dest)
    }
    this.save('evidence', [...list, item])
    return item
  }

  evidenceState(e: Evidence, today: string): EvidenceState {
    const expires = addDays(e.collectedOn, e.validDays)
    let state: EvidenceState['state'] = expires < today ? 'expired' : addDays(today, 30) >= expires ? 'expiring' : 'valid'
    if (e.file) {
      const p = join(this.dir, 'evidence', e.file)
      if (!existsSync(p) || !lstatSync(p).isFile()) state = 'missing'
      else if (e.sha256 && sha256(p) !== e.sha256) state = 'modified'
    }
    return { state, expires }
  }
}

export interface EvidenceState {
  state: 'valid' | 'expiring' | 'expired' | 'missing' | 'modified'
  expires: string
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function today(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date())
}

function sha256(path: string): string {
  const h = createHash('sha256')
  const fd = openSync(path, 'r')
  try {
    const buf = Buffer.alloc(1 << 16)
    let left = fstatSync(fd).size
    while (left > 0) {
      const n = readSync(fd, buf, 0, buf.length, null)
      if (n === 0) break
      h.update(buf.subarray(0, n))
      left -= n
    }
  } finally {
    closeSync(fd)
  }
  return h.digest('hex')
}

