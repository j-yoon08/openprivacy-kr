import { assess, statusNames, type Assessment, type CheckResult } from './assess.ts'
import type { Catalog } from './catalog.ts'
import { targetNames, type Workspace } from './workspace.ts'

export const documentKinds = {
  report: ['갭 분석·개선 보고서', 'md'],
  plan: ['개선 과제 목록', 'csv'],
  'privacy-policy': ['개인정보 처리방침 초안', 'md'],
  'internal-plan': ['내부 관리계획 초안', 'md'],
  ropa: ['개인정보 처리 현황표', 'csv'],
  'ismsp-statement': ['ISMS-P 운영명세서 초안', 'csv'],
  soa: ['ISO 27001 적용성 보고서(SoA) 초안', 'csv'],
  risks: ['위험처리 계획', 'csv'],
} as const
export type DocumentKind = keyof typeof documentKinds

const todo = (s: string) => `【작성 필요: ${s}】`

export function render(kind: DocumentKind, catalog: Catalog, ws: Workspace, today: string): string {
  const data = ws.load()
  const a = assess(catalog, data, ws, today)
  const facts = data.profile.facts
  const text = (id: string, label: string) => (typeof facts[id] === 'string' && facts[id] !== '' ? String(facts[id]) : todo(label))
  const org = text('orgName', '조직 이름')

  switch (kind) {
    case 'report':
      return report(catalog, a, org, today)
    case 'plan':
      return csv([
        ['우선순위', '영역', '점검 ID', '상태', '법적 의무', '필요 상태', '현재', '부족한 점', '개선 방법', '필요 증적', '관련 기준', '담당자', '기한', '규모'],
        ...open(a).map((c) => {
          const ans = data.answers[c.check.id]
          return [c.priorityName, c.check.domain, c.check.id, statusNames[c.status], c.legal ? 'O' : '', c.required, c.current, c.reason, c.check.fix.join('\n'), c.check.evidence.join(', '), mapText(c), ans?.owner ?? '', ans?.due ?? '', c.check.effort]
        }),
      ])
    case 'risks':
      return csv([
        ['ID', '자산', '위협·취약점', '가능성', '영향', '위험도', '처리', '조치 계획', '담당자', '기한', '연결 점검'],
        ...[...data.risks].sort((x, y) => y.likelihood * y.impact - x.likelihood * x.impact).map((r) => [
          r.id, r.asset, r.threat, r.likelihood, r.impact, r.likelihood * r.impact,
          { mitigate: '감소', avoid: '회피', transfer: '전가', accept: '수용' }[r.treatment], r.plan, r.owner, r.due, r.check ?? '',
        ]),
      ])
    case 'ropa':
      return csv([
        ['업무', '처리 목적', '정보주체', '개인정보 항목', '처리 근거', '수집 출처', '보유기간', '제3자 제공', '처리 위탁', '국외 이전', '시스템', '파기 방법'],
        ...data.flows.map((f) => [f.name, f.purpose, f.subjects, f.items, f.legalBasis, f.source, f.retention, f.thirdParties, f.processors, f.overseas, f.systems, f.destruction]),
      ])
    case 'ismsp-statement': {
      const fw = a.frameworks.find((f) => f.id === 'ismsp')
      return csv([
        ['항목', '항목명', '운영 여부', '운영 현황', '관련 문서·기록(증적)', '선택 제외 사유', '점검 상태'],
        ...(fw?.requirements ?? []).map((r) => {
          const rs = r.checks.map((id) => a.checks.find((c) => c.check.id === id)!)
          return [
            r.id, r.title, { met: 'Y', noEvidence: 'Y(증적 보완)', na: 'N/A' }[r.status as string] ?? 'P/N 확인',
            rs.filter((c) => c.status !== 'na').map((c) => `[${statusNames[c.status]}] ${c.check.need}${noteOf(c)}`).join('\n'),
            evidenceText(rs), r.status === 'na' ? rs.map((c) => c.reason).join('\n') : '', statusNames[r.status],
          ]
        }),
      ])
    }
    case 'soa': {
      const fw = a.frameworks.find((f) => f.id === 'iso')
      return csv([
        ['통제 번호', '통제(이 도구의 약칭)', '적용 여부', '포함·제외 사유', '이행 상태', '구현 증적'],
        ...(fw?.requirements ?? []).filter((r) => r.id.startsWith('A.')).map((r) => {
          const rs = r.checks.map((id) => a.checks.find((c) => c.check.id === id)!)
          return [r.id, r.title, r.status === 'na' ? '제외' : '적용', r.status === 'na' ? rs.map((c) => c.reason).join('\n') : todo('위험평가·법규·계약·업무 요구 중 선택 사유'), statusNames[r.status], evidenceText(rs)]
        }),
      ])
    }
    case 'privacy-policy':
      return privacyPolicy()
    case 'internal-plan':
      return internalPlan()
  }

  function noteOf(c: CheckResult): string {
    const n = data.answers[c.check.id]?.note
    return n ? ` — ${n}` : ''
  }
  function evidenceText(rs: CheckResult[]): string {
    const ids = new Set(rs.flatMap((c) => c.evidenceIds))
    return data.evidence.filter((e) => ids.has(e.id)).map((e) => `${e.id} ${e.title}`).join('\n')
  }

  function privacyPolicy(): string {
    const fl = data.flows
    const cond = (id: string) => facts[id] !== false
    const rows = (head: string[], body: string[][]) => table(head, body.length ? body : [head.map(() => todo('처리 흐름 등록'))])
    const value = (s: string, label: string) => s || todo(label)
    const sections: [string, string][] = [
      ['개인정보의 처리 목적', rows(['업무', '목적'], fl.map((f) => [f.name, value(f.purpose, '목적')]))],
      ['처리하는 개인정보의 항목과 처리 근거', rows(['업무', '항목', '처리 근거'], fl.map((f) => [f.name, value(f.items, '항목'), value(f.legalBasis, '근거')])) + '\n\n동의 없이 처리하는 항목은 법적 근거와 함께 위와 같이 구분해 공개합니다(법 제22조③).'],
      ['개인정보의 처리 및 보유 기간', rows(['업무', '보유기간'], fl.map((f) => [f.name, value(f.retention, '보유기간')]))],
      ['개인정보의 파기 절차 및 방법', rows(['업무', '파기 방법'], fl.map((f) => [f.name, value(f.destruction, '파기 방법')])) + (cond('retainedByLaw') ? `\n\n다른 법령에 따라 보존하는 항목: ${todo('보존 근거 법령과 항목')}` : '')],
    ]
    const third = fl.filter((f) => f.thirdParties)
    if (third.length || cond('thirdParty')) sections.push(['개인정보의 제3자 제공', rows(['업무', '제공받는 자·목적·항목·기간'], third.map((f) => [f.name, f.thirdParties]))])
    const proc = fl.filter((f) => f.processors)
    if (proc.length || cond('outsourcing')) sections.push(['개인정보 처리의 위탁', rows(['업무', '수탁자와 위탁업무(재수탁자 포함)'], proc.map((f) => [f.name, f.processors]))])
    const over = fl.filter((f) => f.overseas)
    if (over.length || cond('overseas')) sections.push(['개인정보의 국외 이전', rows(['업무', '이전 근거·항목·국가·시기·방법·받는 자·목적·기간·거부 방법'], over.map((f) => [f.name, f.overseas]))])
    if (cond('sensitive')) sections.push(['민감정보의 공개 가능성 및 비공개 선택 방법', todo('해당되는 경우에만 작성')])
    if (cond('pseudonym')) sections.push(['가명정보의 처리', todo('목적·항목·기간·제공·안전조치')])
    if (cond('autoDecision')) sections.push(['자동화된 결정', todo('기준·절차·처리 방식과 거부·설명 요구 방법(법 제37조의2④)')])
    sections.push(
      ['개인정보의 안전성 확보 조치', a.checks.filter((c) => c.check.map.pipa.some((x) => x.startsWith('기준')) && c.status === 'met').map((c) => `- ${c.check.need}`).join('\n') || todo('충족하고 증적이 있는 조치만 적으세요')],
      ['자동 수집 장치의 설치·운영 및 거부', todo('쿠키 등을 쓰는 경우 목적과 거부 방법')],
      ['정보주체와 법정대리인의 권리·의무 및 행사 방법', `열람·전송·정정·삭제·처리정지·동의철회를 요구할 수 있습니다. 열람은 요구받은 날부터 10일 이내에 조치합니다.\n\n요구 방법: ${todo('홈페이지·서면·전화·메일 등 수집보다 어렵지 않은 방법')}`],
      ['개인정보 보호책임자 및 문의처', `- 개인정보 보호책임자: ${text('cpoName', 'CPO')}\n- 문의처: ${text('contact', '부서·전화·메일')}`],
      ['권익침해 구제 방법', '- 개인정보침해 신고센터: 국번 없이 118 (privacy.kisa.or.kr)\n- 개인정보 분쟁조정위원회: 1833-6972 (kopico.go.kr)'],
    )
    if (cond('foreignOnly')) {
      // 법 제31조의2④, 시행령 제31조①4호: 국내에 주소·영업소가 없는 사업자
      sections.push(['국내대리인', `- 성명(법인은 명칭과 대표자 성명): ${todo('국내대리인 성명')}\n- 주소(법인은 영업소 소재지): ${todo('주소')}\n- 전화번호: ${todo('전화번호')}\n- 전자우편 주소: ${todo('전자우편')}`])
      sections.push(['개인정보를 처리하는 국가', `국외에서 국내 정보주체의 개인정보를 직접 수집해 처리하는 국가: ${todo('국가명')}`])
    }
    if (cond('cctv')) sections.push(['고정형 영상정보처리기기 운영·관리', todo('별도 방침이 없으면 목적·장소·대수·보관기간·책임자를 작성')])
    return [`# 개인정보 처리방침`, draft(today), `${org}은(는) 「개인정보 보호법」 제30조에 따라 이 처리방침을 수립·공개합니다.`, ...sections.map(([t, b], i) => `## ${i + 1}. ${t}\n\n${b}`), `## 부칙\n\n이 처리방침은 ${todo('시행일')}부터 적용합니다. 이전 처리방침: ${todo('링크')}`].join('\n\n') + '\n'
  }

  function internalPlan(): string {
    const items: [string, string[]][] = [
      ['개인정보 보호 조직의 구성 및 운영', ['gov-org']],
      ['개인정보 보호책임자의 자격요건 및 지정', ['gov-cpo', 'gov-cpo-report']],
      ['개인정보 보호책임자와 개인정보취급자의 역할 및 책임', ['gov-cpo', 'ppl-key']],
      ['개인정보취급자에 대한 관리·감독 및 교육', ['ppl-training', 'ppl-nda']],
      ['접근 권한의 관리', ['acc-lifecycle', 'acc-history', 'acc-unique', 'acc-auth', 'acc-review']],
      ['접근통제', ['net-segment', 'net-detect', 'acc-remote-mfa', 'exposure', 'app-timeout', 'net-separation', 'ops-endpoint']],
      ['개인정보의 암호화 조치', ['cry-password', 'cry-store', 'cry-transit', 'cry-endpoint', 'cry-key']],
      ['접속기록 보관 및 점검', ['log-retention', 'log-fields', 'log-review']],
      ['악성프로그램 등 방지', ['ops-malware', 'ops-patch']],
      ['유출·도난 방지 등을 위한 취약점 점검', ['inc-vuln', 'inc-public-pentest']],
      ['물리적 안전조치', ['phy-access', 'phy-office', 'phy-media-inout', 'ops-media']],
      ['출력·복사 시 안전조치', ['app-access', 'ops-print']],
      ['개인정보의 파기', ['prv-destroy', 'ops-dispose']],
      ['유출사고 대응 계획 수립·시행', ['inc-plan', 'inc-possible', 'inc-respond']],
      ['위험 분석 및 관리', ['gov-risk-method', 'gov-risk-treat']],
      ['수탁자에 대한 관리 및 감독', ['sup-contract', 'sup-monitor']],
      ['내부 관리계획의 수립, 변경 및 승인', ['gov-internal-plan', 'gov-internal-plan-review']],
      ['그 밖에 개인정보 보호를 위하여 필요한 사항', ['prv-rights', 'prv-policy']],
    ]
    const body = items.map(([title, ids], i) => {
      const cs = ids.map((id) => a.checks.find((c) => c.check.id === id)).filter((c): c is CheckResult => !!c && c.status !== 'na')
      const lines = cs.map((c) => `- ${c.required}\n  - 현재: ${statusNames[c.status]}${noteOf(c)}`).join('\n')
      return `## 제${i + 1}장 ${title}\n\n${lines || '- ' + todo('우리 조직의 기준')}\n\n- 담당·주기·절차: ${todo('담당 부서, 주기, 세부 절차')}`
    })
    return [`# ${org} 개인정보 내부 관리계획`, draft(today), '근거: 「개인정보 보호법」 제29조, 시행령 제30조, 「개인정보의 안전성 확보조치 기준」 제4조①(18개 사항)', `- 개인정보 보호책임자: ${text('cpoName', 'CPO')}\n- 승인: ${todo('승인권자·승인일')}`, ...body, `## 개정 이력\n\n${table(['판', '일자', '변경 내용', '승인자'], [['1.0', todo('일자'), '제정', todo('승인자')]])}`].join('\n\n') + '\n'
  }
}

const open = (a: Assessment) => a.checks.filter((c) => c.status !== 'met' && c.status !== 'na')
const draft = (today: string) => `> 초안(${today} 생성). 입력값으로 만든 작성 보조 자료입니다. 사실과 맞는지 확인하고 승인한 뒤 사용하세요.`
const mapText = (c: CheckResult) => [c.legal || c.frameworks.includes('pipa') ? c.check.map.pipa.join(', ') : '', c.frameworks.includes('ismsp') ? `ISMS-P ${c.check.map.ismsp.join(', ')}` : '', c.frameworks.includes('iso') && c.check.map.iso.length ? `ISO ${c.check.map.iso.join(', ')}` : ''].filter(Boolean).join(' / ')

function report(catalog: Catalog, a: Assessment, org: string, today: string): string {
  const out: string[] = [`# ${org} 갭 분석·개선 보고서`, `- 작성일: ${today}\n- 대상: ${a.targets.map((t) => targetNames[t]).join(', ')}\n- 기준 확인일: ${catalog.sources.checkedOn}\n- 준비도(충족 + 유효 증적): ${a.readiness}%`]
  out.push('> 자가진단 결과이며 법률 자문, 인증 심사, 적합 판정을 대신하지 않습니다.')
  out.push('> 개인정보 보호법 현황은 점검으로 확인하는 의무 조문만 셉니다. 100%여도 법 전체 준수를 뜻하지 않습니다. 개별 사안은 상황 검토로 전체 조문을 확인하세요.')
  out.push('## 기준별 현황\n\n' + table(['기준', '적용 항목', '충족', '증적 부족', '부분', '부족·불일치', '미응답·확인 필요', '제외'], a.frameworks.map((f) => [f.title, `${f.applicable}/${f.total}`, f.counts.met, f.counts.noEvidence, f.counts.partial, f.counts.gap + f.counts.conflict, f.counts.unanswered + f.counts.needsFact, f.counts.na].map(String))))
  const label = { required: '해당', verify: '확인 필요', notRequired: '비해당' }
  out.push('## 우리 조직의 법적 의무\n\n' + table(['의무', '판정', '내용', '근거'], a.obligations.filter((o) => o.status !== 'notRequired').map((o) => [o.title, label[o.status], o.text, o.basis])))
  const found = open(a).filter((c) => !['unanswered', 'needsFact'].includes(c.status))
  out.push(`## 부족한 점과 개선 방법 (${found.length}건)`)
  for (const c of found) {
    out.push([
      `### [${c.priorityName}] ${cell(c.required)}`,
      `- 상태: **${statusNames[c.status]}**${c.legal ? ' · 법적 의무' : ''}`,
      `- 현재: ${cell(c.current)}`, `- 부족한 점: ${cell(c.reason)}`, `- 관련 기준: ${mapText(c)}`,
      ...(c.sanctions.length ? [`- 조문 단위 제재 참고: ${c.sanctions.map((s) => `법 ${s.article} ${s.item}`).join(', ')}`] : []),
      `- 개선 방법\n${c.check.fix.map((f, i) => `  ${i + 1}. ${f}`).join('\n')}`,
      `- 준비할 증적: ${c.check.evidence.join(', ')}`,
      ...c.findings.map((f) => `- 기술 점검 발견: ${cell(f.title)} (${f.scanner}, ${cell(f.target)})`),
    ].join('\n'))
  }
  if (a.flowIssues.length) out.push('## 개인정보 처리 흐름의 문제\n\n' + table(['업무', '문제', '개선', '근거'], a.flowIssues.map((f) => [f.name, f.issue, f.fix, f.basis])))
  const unknown = open(a).filter((c) => ['unanswered', 'needsFact'].includes(c.status))
  out.push(`## 아직 판단하지 못한 항목 (${unknown.length}건)\n\n` + (unknown.map((c) => `- \`${c.check.id}\` ${cell(c.check.need)} — ${c.reason}`).join('\n') || '없음'))
  out.push('## 근거와 변경 주시\n\n' + table(['근거', '판', '시행일'], catalog.sources.sources.map((s) => [s.title, s.version, s.effective])) + '\n\n' + catalog.sources.watch.map((w) => `- **${w.title}**: ${w.detail}`).join('\n'))
  return out.join('\n\n') + '\n'
}

function cell(s: string): string {
  return s.replace(/\r?\n/g, ' ').replace(/[|<>]/g, (c) => `\\${c}`)
}
function table(head: string[], body: string[][]): string {
  const row = (r: string[]) => `| ${r.map(cell).join(' | ')} |`
  return [row(head), `| ${head.map(() => '---').join(' | ')} |`, ...body.map(row)].join('\n')
}
/** 엑셀에서 수식으로 실행되지 않도록 앞에 '를 붙이고, 한글이 깨지지 않도록 BOM을 넣습니다. */
export function csv(rows: (string | number)[][]): string {
  const enc = (v: string | number) => {
    let s = String(v)
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`
    return `"${s.replace(/"/g, '""')}"`
  }
  return '﻿' + rows.map((r) => r.map(enc).join(',')).join('\r\n') + '\r\n'
}
