#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { assess, statusNames } from './assess.ts'
import { loadCatalog } from './catalog.ts'
import { documentKinds, render, type DocumentKind } from './documents.ts'
import { importProwler, mergeFindings, scanGithub, scanRepo, scanTls, scanWeb } from './scanners.ts'
import { loadLaw, roleNames } from './law.ts'
import { heading, renderReview, reviewSituation, tierNames } from './review.ts'
import { createApp } from './server.ts'
import { InputError, today, Workspace, type Finding } from './workspace.ts'

const usage = `openprivacy-kr — 개인정보 보호법·ISMS-P·ISO 27001 준비 도구

사용법: openprivacy-kr <명령> [옵션]

  init                          작업 폴더 만들기
  serve [--port 4820]           웹 화면 열기(127.0.0.1에만 열림)
  assess [--json] [--strict]    부족한 점과 개선 방법 보기
  review [--text 글 | --file 파일] [--yes id,id] [--no id,id] [--title 제목] [--full] [-o 파일]
                                상황을 법·시행령·고시 전체 조문과 대조(주제 ID는 law topics)
  law [검색어]                  법령 전문 검색(예: law 제34조, law 국외 이전)
  law coverage | law topics     조문별 역할 요약, 상황 주제 목록
  doc <종류> [-o 파일]          문서 만들기
                                ${Object.entries(documentKinds).map(([k, [t]]) => `${k}: ${t}`).join('\n                                ')}
  evidence add <파일> --title 제목 --checks id,id [--owner 담당] [--days 365]
  evidence status               만료·분실·변경된 증적 보기
  scan repo <폴더>              소스의 개인정보·비밀정보·취약 설정 점검
  scan github <owner/repo>      저장소 보안 설정 점검(GITHUB_TOKEN 사용)
  scan tls <host[:port]>        TLS·인증서 점검(권한이 있는 대상만)
  scan web <https://도메인>      HTTPS 전환·HSTS·쿠키 속성·처리방침 표시 점검(첫 화면만)
  import prowler <ocsf.json>    Prowler 결과 가져오기
  sources                       근거 법령·기준과 확인일 보기

공통 옵션: --dir <작업 폴더> (기본값 ./openprivacy)`

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      dir: { type: 'string', default: 'openprivacy' }, port: { type: 'string', default: '4820' }, json: { type: 'boolean' }, strict: { type: 'boolean' },
      output: { type: 'string', short: 'o' }, title: { type: 'string' }, text: { type: 'string' }, file: { type: 'string' }, yes: { type: 'string' }, no: { type: 'string' }, full: { type: 'boolean' }, checks: { type: 'string' }, owner: { type: 'string', default: '' }, days: { type: 'string', default: '365' }, help: { type: 'boolean', short: 'h' },
    },
  })
  const [cmd, sub, arg] = positionals
  if (values.help || !cmd) return console.log(usage)
  const catalog = loadCatalog()
  const ws = new Workspace(values.dir, catalog)
  const need = (v: string | undefined, what: string): string => {
    if (!v) throw new InputError(`${what}이(가) 필요합니다\n\n${usage}`)
    return v
  }
  const store = (fresh: Finding[], target = fresh[0]?.target ?? '') => {
    if (!fresh.length) return console.log('가져올 결과가 없습니다.')
    ws.save('findings', mergeFindings(ws.load().findings, fresh, fresh[0]!.scanner, target))
    const mark = { pass: '통과', fail: '실패', unknown: '확인 필요' }
    for (const f of fresh) console.log(`[${mark[f.status]}] ${f.title}${f.status !== 'pass' && f.detail ? ` — ${f.detail}` : ''}`)
    console.log('\n통과 결과만으로 요구사항 충족으로 처리하지 않습니다. 실패는 관련 답변과 대조됩니다.')
  }

  switch (cmd) {
    case 'init':
      ws.init()
      return console.log(`작업 폴더를 만들었습니다: ${ws.dir}\n다음: openprivacy-kr serve --dir ${values.dir}`)
    case 'serve': {
      ws.init()
      const { server, token } = createApp(ws, catalog)
      const port = Number(values.port)
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new InputError('포트는 0~65535 사이의 정수여야 합니다')
      server.on('error', (e: NodeJS.ErrnoException) => { console.error(e.code === 'EADDRINUSE' ? `포트 ${port}를 이미 사용 중입니다. --port로 바꾸세요.` : e.message); process.exit(1) })
      server.listen(port, '127.0.0.1', () => console.log(`브라우저에서 여세요: http://127.0.0.1:${(server.address() as { port: number }).port}/#${token}\n작업 폴더: ${ws.dir}\n종료: Ctrl+C`))
      return
    }
    case 'assess': {
      const a = assess(catalog, ws.load(), ws, today())
      const open = a.checks.filter((c) => c.status !== 'met' && c.status !== 'na')
      if (values.json) console.log(JSON.stringify(a, null, 2))
      else {
        console.log(`준비도 ${a.readiness}% (충족 + 유효 증적)`)
        for (const f of a.frameworks) console.log(`- ${f.title}: 충족 ${f.counts.met}/${f.applicable}, 부족·불일치 ${f.counts.gap + f.counts.conflict}, 부분 ${f.counts.partial}, 증적 부족 ${f.counts.noEvidence}, 미판단 ${f.counts.unanswered + f.counts.needsFact}`)
        console.log('\n법적 의무')
        for (const o of a.obligations) if (o.status !== 'notRequired') console.log(`- [${o.status === 'required' ? '해당' : '확인 필요'}] ${o.title}: ${o.text} (${o.basis})`)
        console.log('\n부족한 점과 개선 방법')
        for (const c of open.filter((x) => x.status !== 'unanswered' && x.status !== 'needsFact')) {
          console.log(`\n[${c.priorityName}] ${c.required}\n  상태: ${statusNames[c.status]}${c.legal ? ' · 법적 의무' : ''} / 현재: ${c.current}\n  부족: ${c.reason}`)
          c.check.fix.forEach((f, i) => console.log(`  ${i + 1}) ${f}`))
          console.log(`  증적: ${c.check.evidence.join(', ')}`)
        }
        for (const i of a.flowIssues) console.log(`\n[처리 흐름] ${i.name}: ${i.issue}\n  → ${i.fix} (${i.basis})`)
        console.log(`\n아직 판단하지 못한 항목 ${a.counts.unanswered + a.counts.needsFact}건`)
        const stale = a.checks.filter((c) => c.stale)
        if (stale.length) console.log(`1년 넘게 다시 확인하지 않은 답변 ${stale.length}건: ${stale.map((c) => c.check.id).join(', ')}`)
      }
      if (values.strict && open.some((c) => c.legal)) process.exitCode = 2
      return
    }
    case 'doc': {
      const kind = need(sub, '문서 종류')
      if (!Object.hasOwn(documentKinds, kind)) throw new InputError(`없는 문서 종류: ${kind}`)
      const out = render(kind as DocumentKind, catalog, ws, today())
      if (!values.output) return void process.stdout.write(out)
      if (existsSync(values.output)) throw new InputError(`이미 있는 파일입니다: ${values.output}`)
      writeFileSync(values.output, out, { mode: 0o600 })
      return console.log(`만들었습니다: ${resolve(values.output)}`)
    }
    case 'evidence': {
      if (sub === 'add') {
        const file = need(arg, '증적 파일')
        if (!existsSync(file)) throw new InputError(`파일이 없습니다: ${file}`)
        const e = ws.addEvidence({ title: values.title ?? basename(file), checks: need(values.checks, '--checks').split(','), owner: values.owner, collectedOn: today(), validDays: Number(values.days) }, { path: file })
        return console.log(`${e.id} 등록 (sha256 ${e.sha256})`)
      }
      if (sub !== 'status') throw new InputError('evidence add 또는 evidence status를 쓰세요')
      const names = { valid: '유효', expiring: '30일 내 만료', expired: '만료', missing: '파일 없음', modified: '내용 변경됨' }
      let bad = 0
      for (const e of ws.load().evidence) {
        const s = ws.evidenceState(e, today())
        if (s.state !== 'valid') bad++
        console.log(`[${names[s.state]}] ${e.id} ${e.title} (만료 ${s.expires}, ${e.owner || '담당자 없음'})`)
      }
      if (bad) process.exitCode = 2
      return
    }
    case 'scan':
      ws.load()
      if (sub === 'repo') return store(scanRepo(resolve(need(arg, '폴더'))))
      if (sub === 'github') return store(await scanGithub(need(arg, 'owner/repo'), process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN))
      if (sub === 'tls') return store(await scanTls(need(arg, 'host')))
      if (sub === 'web') return store(await scanWeb(need(arg, 'https://도메인')))
      throw new InputError('scan repo, scan github, scan tls, scan web 중 하나를 쓰세요')
    case 'import':
      if (sub !== 'prowler') throw new InputError('import prowler <파일>을 쓰세요')
      ws.load()
      return store(importProwler(JSON.parse(readFileSync(need(arg, 'OCSF JSON 파일'), 'utf8')), catalog))
    case 'review': {
      const text = values.text ?? (values.file ? readFileSync(values.file, 'utf8') : '')
      if (!text.trim()) throw new InputError('--text나 --file로 상황을 적으세요')
      const book = loadLaw(catalog)
      const topics = Object.fromEntries([...(values.yes?.split(',') ?? []).map((t) => [t, 'yes'] as const), ...(values.no?.split(',') ?? []).map((t) => [t, 'no'] as const)])
      for (const t of Object.keys(topics)) if (!book.topics.some((x) => x.id === t)) throw new InputError(`없는 주제: ${t} (law topics로 확인)`)
      if (values.output) {
        if (existsSync(values.output)) throw new InputError(`이미 있는 파일입니다: ${values.output}`)
        writeFileSync(values.output, renderReview(catalog, ws, { title: values.title ?? '제목 없음', text, topics }, today(), !!values.full), { mode: 0o600 })
        return console.log(`만들었습니다: ${resolve(values.output)}`)
      }
      const r = reviewSituation(book, text, topics)
      if (values.json) return console.log(JSON.stringify(r, null, 2))
      console.log(`찾은 주제: ${r.topics.map((t) => t.title).join(', ') || '없음(--yes로 고르거나 더 구체적으로 적으세요)'}`)
      console.log(r.topics.flatMap((t) => t.ask).map((q) => `  ? ${q}`).join('\n'))
      for (const t of ['direct', 'always', 'related'] as const) {
        const list = r.items.filter((i) => i.tier === t)
        console.log(`\n${tierNames[t]} ${list.length}개`)
        for (const i of list) console.log(`- ${heading(book.byId.get(i.id)!)} — ${i.reasons.join(', ')}`)
      }
      console.log(`\n확인 필요 ${r.items.filter((i) => i.tier === 'confirm').length}개 — 아래 질문에 답하면(--yes, --no) 줄어듭니다`)
      for (const id of r.open) console.log(`  [${id}] ${book.topics.find((t) => t.id === id)!.q}`)
      console.log(`\n나머지 ${r.items.filter((i) => i.tier === 'rest').length}개 / 전체 ${r.items.length}개. 전문을 포함한 검토서는 -o 파일로 만드세요.`)
      return
    }
    case 'law': {
      const book = loadLaw(catalog)
      const query = positionals.slice(1).join(' ')
      if (query === 'topics') return book.topics.forEach((t) => console.log(`${t.id.padEnd(14)}${t.title} — ${t.q}`))
      if (query === 'coverage' || !query) {
        for (const t of book.texts) {
          const ps = book.provisions.filter((p) => p.source === t.id)
          const arts = ps.filter((p) => p.kind === 'article')
          const roles = t.id === 'decree' ? '법 조문에 연결' : (Object.keys(roleNames) as (keyof typeof roleNames)[]).map((r) => `${roleNames[r]} ${arts.filter((p) => p.role === r).length}`).join(', ')
          console.log(`${t.title} (${t.version}, 시행 ${t.effective}): 현행 ${arts.filter((p) => p.text).length}개 조, 신설 예정 ${arts.filter((p) => !p.text).length}개 조 [${roles}], 별표 ${ps.filter((p) => p.kind === 'annex').length}, 부칙 ${ps.filter((p) => p.kind === 'addendum').length}`)
        }
        return
      }
      const exact = book.byId.get(query)
      const found = exact ? [exact] : book.provisions.filter((p) => `${p.id} ${p.title} ${p.text} ${p.upcoming?.text ?? ''}`.includes(query))
      for (const p of found) {
        console.log(`\n■ ${heading(p)} [${roleNames[p.role]}: ${p.why}]`)
        if (exact || found.length <= 3) console.log([p.text, p.upcoming ? `\n(시행 예정 ${p.upcoming.effective})\n${p.upcoming.text}` : '', p.implementedBy.length ? `\n세부 규정: ${p.implementedBy.join(', ')}` : '', p.sanctions.length ? `제재: ${p.sanctions.map((s) => `${s.article} ${s.item}`).join(', ')}` : ''].filter(Boolean).join('\n'))
      }
      return console.log(`\n${found.length}건`)
    }
    case 'sources':
      console.log(`기준 확인일 ${catalog.sources.checkedOn}\n`)
      for (const s of catalog.sources.sources) console.log(`- ${s.title} | ${s.version} | 시행 ${s.effective}\n  ${s.url}`)
      console.log('\n변경 주시')
      for (const w of catalog.sources.watch) console.log(`- ${w.title}: ${w.detail}`)
      return
    default:
      throw new InputError(`없는 명령: ${cmd}\n\n${usage}`)
  }
}

main().catch((e: unknown) => {
  const known = e instanceof InputError || (e instanceof Error && 'code' in e && String(e.code).startsWith('ERR_PARSE_ARGS'))
  console.error(known || e instanceof SyntaxError ? (e as Error).message : e)
  process.exitCode = 1
})
