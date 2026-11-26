import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import { basename, extname, join, relative } from 'node:path'
import { connect } from 'node:tls'
import { request } from 'node:https'
import { z } from 'zod'
import type { Catalog } from './catalog.ts'
import { InputError, type Finding } from './workspace.ts'

type Draft = Omit<Finding, 'scanner' | 'target' | 'at'>
const stamp = (scanner: string, target: string, list: Draft[]): Finding[] => list.map((f) => ({ ...f, scanner, target, at: new Date().toISOString() }))

/** 같은 점검기·대상의 이전 결과를 새 결과로 바꿉니다. */
export function mergeFindings(old: Finding[], fresh: Finding[], scanner: string, target: string): Finding[] {
  return [...old.filter((f) => f.scanner !== scanner || f.target !== target), ...fresh]
}

const skipDirs = new Set(['.git', 'node_modules', 'dist', 'build', 'vendor', '.venv', 'venv', '__pycache__', '.next', 'target'])
const binary = new Set('.png .jpg .jpeg .gif .webp .ico .pdf .zip .gz .jar .woff .woff2 .ttf .mp4 .mp3 .exe .dll .so .dylib .class .pyc'.split(' '))
const maxBytes = 1_000_000

/** 카드번호 끝자리 검증(Luhn). 13~19자리만 봅니다. */
function luhn(d: string): boolean {
  if (d.length < 13 || d.length > 19 || /^(\d)\1+$/.test(d)) return false
  let sum = 0
  for (let i = 0; i < d.length; i++) {
    let n = +d[d.length - 1 - i]!
    if (i % 2) { n *= 2; if (n > 9) n -= 9 }
    sum += n
  }
  return sum % 10 === 0
}
const placeholder = /^(?:\$\{|\{\{|<|%\(|process\.env|os\.environ|env\(|getenv)|change.?me|example|sample|dummy|placeholder|your[_-]|xxxx|\*\*\*\*|redacted|test|password$/i
const lockFiles = new Set(['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'poetry.lock', 'Cargo.lock', 'go.sum', 'composer.lock', 'Gemfile.lock'])

interface SourceRule { id: string; title: string; checks: string[]; pattern: RegExp; accept?: (m: RegExpExecArray) => boolean; only?: Set<string> }
const codeExt = new Set('.js .mjs .cjs .ts .tsx .jsx .py .java .kt .go .rb .php .cs .swift .rs .scala'.split(' '))
const sourceRules: SourceRule[] = [
  { id: 'rrn', title: '주민등록번호·외국인등록번호로 보이는 값', checks: ['dev-data', 'cry-store'], pattern: /(?<!\d)(\d{2})(\d{2})(\d{2})-[1-8]\d{6}(?!\d)/g, accept: (m) => +m[2]! >= 1 && +m[2]! <= 12 && +m[3]! >= 1 && +m[3]! <= 31 },
  { id: 'card', title: '카드번호로 보이는 값(Luhn 검증 통과)', checks: ['dev-data', 'cry-store'], pattern: /(?<![\d-])(?:\d[ -]?){14,18}\d(?![\d-])/g, accept: (m) => luhn(m[0].replace(/\D/g, '')) },
  { id: 'phone', title: '휴대전화번호로 보이는 값', checks: ['dev-data'], pattern: /(?<![\d-])01[016789][-. ]?\d{3,4}[-. ]?\d{4}(?![\d-])/g },
  { id: 'driver-license', title: '운전면허번호로 보이는 값', checks: ['dev-data', 'cry-store'], pattern: /(?<![\d-])(?:1[1-9]|2[0-8])-\d{2}-\d{6}-\d{2}(?![\d-])/g },
  { id: 'private-key', title: '개인키 파일·문자열', checks: ['cry-key', 'dev-source'], pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g },
  { id: 'aws-key', title: 'AWS 액세스 키 ID로 보이는 값', checks: ['cry-key', 'dev-source'], pattern: /(?<![A-Z0-9])AKIA[0-9A-Z]{16}(?![A-Z0-9])/g },
  { id: 'github-token', title: 'GitHub 토큰으로 보이는 값', checks: ['cry-key', 'dev-source'], pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g },
  { id: 'aws-secret', title: 'AWS 비밀 액세스 키로 보이는 값', checks: ['cry-key', 'dev-source'], pattern: /aws_?secret_?access_?key["']?\s*[:=]\s*["']?[A-Za-z0-9/+=]{40}(?![A-Za-z0-9/+=])/gi },
  { id: 'service-token', title: '클라우드·SaaS API 키로 보이는 값(Slack·Google·Stripe·Anthropic·OpenAI)', checks: ['cry-key', 'dev-source'], pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}|\bAIza[0-9A-Za-z_-]{35}\b|\b[sr]k_live_[0-9A-Za-z]{20,}|\bsk-ant-[A-Za-z0-9_-]{20,}|\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/g },
  { id: 'hardcoded-secret', title: '소스에 직접 쓴 비밀번호·비밀키 의심', checks: ['cry-key', 'dev-source'], pattern: /(?<![A-Za-z0-9])(?:password|passwd|pwd|secret|api_?key|access_?token|auth_?token|client_?secret|private_?key)["']?\s*[:=]\s*["']([^"'\s]{8,})["']/gi, accept: (m) => !placeholder.test(m[1]!), only: new Set([...codeExt, '.yml', '.yaml', '.json', '.properties', '.ini', '.toml', '.xml', '.conf']) },
  { id: 'weak-password-hash', title: '비밀번호에 취약한 해시(MD5·SHA-1) 사용 의심', checks: ['cry-password'], pattern: /\b(?:md5|sha1)\b[^\n]{0,60}\b(?:password|passwd|pwd)\b|\b(?:password|passwd|pwd)\b[^\n]{0,60}\b(?:md5|sha1)\b/gi, only: codeExt },
  { id: 'tls-verify-off', title: 'TLS 인증서 검증 비활성화', checks: ['cry-transit'], pattern: /rejectUnauthorized\s*:\s*false|verify\s*=\s*False|InsecureSkipVerify\s*:\s*true|CURLOPT_SSL_VERIFYPEER\s*,\s*(?:false|0)/g, only: codeExt },
]

/** 소스 폴더 점검. 발견한 값 자체는 기록하지 않고 파일과 줄 번호만 남깁니다. */
export function scanRepo(dir: string): Finding[] {
  if (!lstatSync(dir).isDirectory()) throw new InputError('폴더를 지정하세요')
  const hits = new Map<string, string[]>(sourceRules.map((r) => [r.id, []]))
  const envFiles: string[] = []
  let scanned = 0
  let skipped = 0
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isSymbolicLink()) continue
      if (e.isDirectory()) { if (!skipDirs.has(e.name)) walk(p); continue }
      if (!e.isFile()) continue
      const rel = relative(dir, p)
      if (/^\.env(\.|$)/.test(e.name) && !/(example|sample|template)$/.test(e.name)) envFiles.push(rel)
      const ext = extname(e.name).toLowerCase()
      if (binary.has(ext) || lockFiles.has(e.name)) continue
      if (lstatSync(p).size > maxBytes) { skipped++; continue }
      const buf = readFileSync(p)
      if (buf.includes(0)) continue
      scanned++
      const text = buf.toString('utf8')
      for (const r of sourceRules) {
        if (r.only && !r.only.has(ext)) continue
        for (const m of text.matchAll(r.pattern)) {
          if (r.accept && !r.accept(m)) continue
          hits.get(r.id)!.push(`${rel}:${text.slice(0, m.index).split('\n').length}`)
        }
      }
    }
  }
  walk(dir)
  const note = `검사 ${scanned}개 파일${skipped ? `, 1MB 초과로 제외 ${skipped}개` : ''}`
  const list: Draft[] = sourceRules.map((r) => {
    const h = hits.get(r.id)!
    return { rule: r.id, title: h.length ? `${r.title} ${h.length}건` : `${r.title}: 발견 없음`, status: h.length ? 'fail' : 'pass', detail: h.length ? `${h.slice(0, 20).join(', ')}${h.length > 20 ? ' …' : ''}` : note, checks: r.checks }
  })
  list.push({ rule: 'env-file', title: envFiles.length ? `환경 변수 파일 ${envFiles.length}개(커밋 여부 확인 필요)` : '환경 변수 파일: 발견 없음', status: envFiles.length ? 'unknown' : 'pass', detail: envFiles.slice(0, 20).join(', '), checks: ['cry-key'] })
  return stamp('repo', basename(dir), list)
}

export type Fetch = (url: string, init: { headers: Record<string, string> }) => Promise<{ status: number; json(): Promise<unknown> }>

export async function scanGithub(repo: string, token: string | undefined, get: Fetch = fetch): Promise<Finding[]> {
  if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(repo)) throw new InputError('owner/repo 형식으로 적으세요')
  const api = async (path: string) => {
    const r = await get(`https://api.github.com/repos/${repo}${path}`, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'openprivacy-kr', ...(token ? { authorization: `Bearer ${token}` } : {}) } })
    return { status: r.status, body: r.status === 200 ? await r.json() : undefined }
  }
  const meta = await api('')
  if (meta.status !== 200) throw new InputError(`저장소를 읽지 못했습니다(HTTP ${meta.status}). GITHUB_TOKEN 권한을 확인하세요.`)
  const onOff = z.object({ status: z.string() }).optional()
  const info = z.object({ default_branch: z.string(), security_and_analysis: z.object({ secret_scanning: onOff, secret_scanning_push_protection: onOff }).nullish() }).parse(meta.body)
  const list: Draft[] = []
  const branch = await api(`/branches/${encodeURIComponent(info.default_branch)}`)
  const isProtected = branch.status === 200 ? z.object({ protected: z.boolean() }).parse(branch.body).protected : undefined
  list.push({ rule: 'branch-protection', status: isProtected === undefined ? 'unknown' : isProtected ? 'pass' : 'fail', title: `기본 브랜치(${info.default_branch}) 보호 ${isProtected === undefined ? '확인 불가' : isProtected ? '사용' : '미사용'}`, detail: '리뷰 필수 여부 등 세부 규칙은 별도로 확인하세요.', checks: ['dev-source', 'dev-release'] })
  for (const [rule, label, v] of [
    ['secret-scanning', '비밀정보 스캔', info.security_and_analysis?.secret_scanning?.status],
    ['push-protection', '비밀정보 푸시 차단', info.security_and_analysis?.secret_scanning_push_protection?.status],
  ] as const) list.push({ rule, status: v === undefined ? 'unknown' : v === 'enabled' ? 'pass' : 'fail', title: `${label} ${v === undefined ? '확인 불가(관리자 권한 필요)' : v === 'enabled' ? '사용' : '미사용'}`, detail: '', checks: ['dev-source'] })
  const alerts = await api('/dependabot/alerts?state=open&severity=critical,high&per_page=100')
  const n = alerts.status === 200 ? z.array(z.unknown()).parse(alerts.body).length : undefined
  list.push({ rule: 'dependency-alerts', status: n === undefined ? 'unknown' : n ? 'fail' : 'pass', title: n === undefined ? '의존성 취약점 경보 확인 불가' : `열린 높음·심각 의존성 경보 ${n}건${n === 100 ? ' 이상' : ''}`, detail: '', checks: ['dev-test', 'ops-patch'] })
  return stamp('github', repo, list)
}

export async function scanTls(target: string): Promise<Finding[]> {
  if (!/^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(target)) throw new InputError('host 또는 host:port 형식으로 적으세요')
  const [host = '', port = '443'] = target.split(':')
  const list: Draft[] = []
  const handshake = (options: { minVersion?: 'TLSv1.2' | 'TLSv1'; maxVersion?: 'TLSv1.1'; ciphers?: string }) =>
    new Promise<{ ok: boolean; protocol?: string; authorized?: boolean; validTo?: string; error?: string }>((done) => {
      const s = connect({ host, port: Number(port), servername: host, rejectUnauthorized: false, timeout: 8000, ...options }, () => {
        done({ ok: true, protocol: s.getProtocol() ?? '', authorized: s.authorized, validTo: s.getPeerCertificate().valid_to, error: String(s.authorizationError ?? '') })
        s.destroy()
      })
      s.on('error', (e) => done({ ok: false, error: (e as NodeJS.ErrnoException).code ?? e.message }))
      s.on('timeout', () => { s.destroy(); done({ ok: false, error: 'timeout' }) })
    })
  const now = await handshake({ minVersion: 'TLSv1.2' })
  if (!now.ok && /ENOTFOUND|ECONNREFUSED|timeout|EHOSTUNREACH|ENETUNREACH|ECONNRESET|EAI_AGAIN/.test(now.error ?? '')) throw new InputError(`연결하지 못했습니다: ${now.error}`)
  list.push({ rule: 'tls12', status: now.ok ? 'pass' : 'fail', title: now.ok ? `${now.protocol} 연결 가능` : 'TLS 1.2 이상 연결 실패', detail: now.error ?? '', checks: ['cry-transit'] })
  if (now.ok) {
    const days = Math.floor((Date.parse(now.validTo ?? '') - Date.now()) / 86_400_000)
    list.push({ rule: 'certificate', status: now.authorized && days >= 14 ? 'pass' : 'fail', title: now.authorized ? `인증서 만료까지 ${days}일` : '인증서를 신뢰할 수 없음', detail: now.error ?? '', checks: ['cry-transit'] })
  }
  // SECLEVEL=0이 있어야 Node가 TLS 1.0/1.1을 실제로 제안합니다. 실패 원인이 서버 거부가 아닐 수 있으면 unknown입니다.
  const old = await handshake({ minVersion: 'TLSv1', maxVersion: 'TLSv1.1', ciphers: 'DEFAULT@SECLEVEL=0' })
  const refused = /PROTOCOL_VERSION|UNSUPPORTED_PROTOCOL|HANDSHAKE_FAILURE|ECONNRESET|ALERT/.test(old.error ?? '')
  list.push({ rule: 'legacy-tls', status: old.ok ? 'fail' : refused ? 'pass' : 'unknown', title: old.ok ? `구버전 ${old.protocol} 허용` : refused ? 'TLS 1.0/1.1 거부' : 'TLS 1.0/1.1 확인 불가', detail: old.error ?? '', checks: ['cry-transit'] })
  const hsts = await new Promise<string | undefined>((done) => {
    const r = request({ host, port: Number(port), method: 'HEAD', path: '/', timeout: 8000, rejectUnauthorized: false, headers: { 'user-agent': 'openprivacy-kr' } }, (res) => { res.resume(); done(String(res.headers['strict-transport-security'] ?? '')) })
    r.on('error', () => done(undefined))
    r.on('timeout', () => { r.destroy(); done(undefined) })
    r.end()
  })
  list.push({ rule: 'hsts', status: hsts === undefined ? 'unknown' : hsts ? 'pass' : 'unknown', title: hsts ? 'HSTS 사용' : 'HSTS 헤더 없음 또는 확인 불가(권장 사항)', detail: hsts ?? '', checks: [] })
  return stamp('tls', target, list)
}

const ocsf = z.array(z.looseObject({
  status_code: z.string(),
  metadata: z.looseObject({ event_code: z.string() }),
  finding_info: z.looseObject({ title: z.string() }),
  cloud: z.looseObject({ provider: z.string().optional(), account: z.looseObject({ uid: z.string().optional() }).optional() }).optional(),
  unmapped: z.looseObject({ compliance: z.record(z.string(), z.array(z.string())).optional() }).optional(),
}))

/** Prowler OCSF JSON을 점검 ID별로 모읍니다. 계정·리소스 식별자는 저장하지 않습니다. */
export function importProwler(json: unknown, catalog: Catalog): Finding[] {
  const parsed = ocsf.safeParse(json)
  if (!parsed.success) throw new InputError('Prowler OCSF JSON 형식이 아닙니다')
  const accounts = new Set<string>()
  const groups = new Map<string, { title: string; pass: number; fail: number; reqs: Set<string>; iso: Set<string> }>()
  for (const f of parsed.data) {
    if (f.status_code !== 'PASS' && f.status_code !== 'FAIL') continue
    const id = f.metadata.event_code
    accounts.add(`${f.cloud?.provider ?? 'cloud'}:${f.cloud?.account?.uid ?? ''}`)
    const g = groups.get(id) ?? { title: f.finding_info.title, pass: 0, fail: 0, reqs: new Set<string>(), iso: new Set<string>() }
    g[f.status_code === 'FAIL' ? 'fail' : 'pass']++
    for (const [k, v] of Object.entries(f.unmapped?.compliance ?? {})) {
      if (k.startsWith('KISA-ISMS-P')) v.forEach((x) => g.reqs.add(x))
      if (k === 'ISO27001-2022') v.forEach((x) => g.iso.add(x.startsWith('A.') ? x : `A.${x}`))
    }
    groups.set(id, g)
  }
  const list: Draft[] = [...groups].map(([id, g]) => {
    // ISMS-P 매핑이 있으면 그것만 씁니다. ISO 통제는 범위가 넓어 엉뚱한 항목까지 연결됩니다.
    const linked = catalog.checks.filter((c) => (g.reqs.size ? c.map.ismsp.some((r) => g.reqs.has(r)) : c.map.iso.some((r) => g.iso.has(r))))
    return { rule: id, status: g.fail ? 'fail' : 'pass', title: g.title, detail: `실패 ${g.fail}건, 통과 ${g.pass}건`, checks: linked.filter((c) => c.type === 'level').map((c) => c.id) }
  })
  // 계정 번호 대신 해시를 써서 계정별 결과가 서로 덮어쓰지 않게 합니다
  const key = createHash('sha256').update([...accounts].sort().join('|')).digest('hex').slice(0, 8)
  return stamp('prowler', `${[...accounts][0]?.split(':')[0] ?? 'cloud'}-${key}`, list)
}
