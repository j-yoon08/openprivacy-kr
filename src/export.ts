import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { assess, statusNames } from './assess.ts'
import type { Catalog } from './catalog.ts'
import { csv } from './documents.ts'
import { InputError, type Workspace } from './workspace.ts'

const stateNames = { valid: '유효', expiring: '30일 내 만료', expired: '만료', missing: '파일 없음', modified: '내용 변경됨' }

/**
 * 심사 제출용 증적 묶음을 만듭니다: 증적 파일 사본, 증적 목록, ISMS-P 항목별 증적표.
 * 파일이 없거나 내용이 바뀐 증적은 복사하지 않고 목록에 상태로 남깁니다.
 */
export function exportEvidence(catalog: Catalog, ws: Workspace, out: string, today: string): { files: number; skipped: number } {
  const dir = resolve(out)
  if (existsSync(dir) && readdirSync(dir).length) throw new InputError(`비어 있지 않은 폴더입니다: ${dir}`)
  mkdirSync(join(dir, 'files'), { recursive: true, mode: 0o700 })
  const data = ws.load()
  const a = assess(catalog, data, ws, today)
  const byCheck = new Map(catalog.checks.map((c) => [c.id, c]))
  const states = new Map(data.evidence.map((e) => [e.id, ws.evidenceState(e, today)]))
  let files = 0
  let skipped = 0
  const copied = new Map<string, string>()
  for (const e of data.evidence) {
    if (!e.file) continue
    const s = states.get(e.id)!.state
    if (s === 'missing' || s === 'modified') { skipped++; continue }
    const name = e.file.startsWith(e.id) ? e.file : `${e.id}-${e.file}`
    copyFileSync(join(ws.dir, 'evidence', e.file), join(dir, 'files', name))
    copied.set(e.id, `files/${name}`)
    files++
  }
  const maps = (ids: string[], fw: 'ismsp' | 'pipa' | 'iso') => [...new Set(ids.flatMap((id) => byCheck.get(id)?.map[fw] ?? []))].join(', ')
  writeFileSync(join(dir, '증적목록.csv'), csv([
    ['증적 ID', '제목', '담당', '수집일', '만료일', '상태', '파일', 'SHA-256(등록 시)', '링크', '연결 점검', 'ISMS-P 항목', '개인정보 보호법 조문', 'ISO/IEC 27001'],
    ...data.evidence.map((e) => {
      const s = states.get(e.id)!
      return [e.id, e.title, e.owner, e.collectedOn, s.expires, stateNames[s.state], copied.get(e.id) ?? '', e.sha256 ?? '', e.link ?? '', e.checks.join(', '), maps(e.checks, 'ismsp'), maps(e.checks, 'pipa'), maps(e.checks, 'iso')]
    }),
  ]))
  const usable = (id: string) => ['valid', 'expiring'].includes(states.get(id)?.state ?? '')
  const fw = a.frameworks.find((f) => f.id === 'ismsp')
  if (fw) {
    writeFileSync(join(dir, 'ISMS-P_항목별_증적.csv'), csv([
      ['항목', '항목명', '점검 상태', '유효한 증적', '증적이 없는 적용 점검'],
      ...fw.requirements.filter((r) => r.status !== 'na').map((r) => {
        const live = r.checks.map((id) => a.checks.find((c) => c.check.id === id)!).filter((c) => c.status !== 'na')
        const ev = data.evidence.filter((e) => usable(e.id) && e.checks.some((id) => r.checks.includes(id)))
        const without = live.filter((c) => !ev.some((e) => e.checks.includes(c.check.id)))
        return [r.id, r.title, statusNames[r.status], ev.map((e) => `${e.id} ${e.title}`).join('\n'), without.map((c) => `${c.check.id} ${c.check.need}`).join('\n')]
      }),
    ]))
  }
  return { files, skipped }
}
