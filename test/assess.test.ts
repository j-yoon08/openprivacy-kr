import assert from 'node:assert/strict'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { assess } from '../src/assess.ts'
import { catalog, day, duty, result, setup, workspace } from './helpers.ts'

test('접속기록: 5만명 이상이면 12개월 보관은 부족하다', () => {
  assert.equal(result('log-retention', { subjects: 50000 }, { 'log-retention': { value: 12 } }).status, 'gap')
  assert.equal(result('log-retention', { subjects: 50000 }, { 'log-retention': { value: 24 } }).status, 'noEvidence')
})
test('접속기록: 5만명 미만이라도 고유식별정보를 처리하면 24개월이 필요하다', () => {
  assert.equal(result('log-retention', { subjects: 100, uniqueId: true }, { 'log-retention': { value: 23 } }).status, 'gap')
})
test('접속기록: 모든 예외가 아님이 확인되면 12개월로 충분하다', () => {
  const small = { subjects: 49999, uniqueId: false, sensitive: false, carrier: false }
  assert.equal(result('log-retention', small, { 'log-retention': { value: 12 } }).status, 'noEvidence')
  assert.equal(result('log-retention', small, { 'log-retention': { value: 11 } }).status, 'gap')
})
test('접속기록: 규모를 모르면 12개월을 충족으로 단정하지 않지만, 어느 기준으로도 확실한 값은 판단한다', () => {
  const unknown = result('log-retention', {}, { 'log-retention': { value: 12 } })
  assert.equal(unknown.status, 'needsFact')
  assert.ok(unknown.missing.includes('subjects'))
  assert.equal(result('log-retention', {}, { 'log-retention': { value: 6 } }).status, 'gap')
  assert.equal(result('log-retention', {}, { 'log-retention': { value: 24 } }).status, 'noEvidence')
})
test('주기형 점검에서 0개월(미실시)은 충족이 아니다', () => {
  assert.equal(result('gov-internal-plan-review', { subjects: 50000 }, { 'gov-internal-plan-review': { value: 0 } }).status, 'gap')
})

test('ISMS 의무: 정보통신서비스 매출 100억원 경계와 금융회사 제외', () => {
  const base = { onlineService: true, majorIsp: false, idc: false, revenue: 100, dailyUsers: 0, financial: false }
  assert.equal(duty('isms', { ...base, itRevenue: 100 }), 'required')
  assert.equal(duty('isms', { ...base, itRevenue: 99 }), 'notRequired')
  assert.equal(duty('isms', { ...base, itRevenue: 500, financial: true }), 'notRequired')
  assert.equal(duty('isms', { onlineService: true }), 'verify')
})
test('ISMS 의무: 매출 1,500억원 + 재학생 1만명 대학', () => {
  const uni = { onlineService: true, revenue: 1500, university: true, financial: false }
  assert.equal(duty('isms', { ...uni, students: 10000 }), 'required')
})
test('CPO 신고: 1,800억원 "초과"와 100만명 이상', () => {
  const base = { school: false, hospital: false, university: false, tertiaryHospital: false, publicSystem: false, subjects: 1000000 }
  assert.equal(duty('cpo-report', { ...base, revenue: 1801 }), 'required')
  assert.equal(duty('cpo-report', { ...base, revenue: 1800 }), 'notRequired')
})
test('암호키·재해대비: 대기업 10만명, 중소기업 100만명', () => {
  assert.equal(duty('key-dr', { sizeClass: 'large', orgType: 'private', subjects: 100000 }), 'required')
  assert.equal(duty('key-dr', { sizeClass: 'small', orgType: 'private', subjects: 999999 }), 'notRequired')
  assert.equal(duty('key-dr', { sizeClass: 'small', orgType: 'private', subjects: 1000000 }), 'required')
})
test('내부 관리계획: 1만명 미만 소상공인만 생략할 수 있다', () => {
  assert.equal(duty('internal-plan', { sizeClass: 'micro', orgType: 'private', subjects: 9999 }), 'notRequired')
  assert.equal(duty('internal-plan', { sizeClass: 'small', orgType: 'private', subjects: 9999 }), 'required')
  assert.equal(duty('internal-plan', { sizeClass: 'micro', orgType: 'private', subjects: 10000 }), 'required')
})
test('ISMS-P 의무는 대상 기준이 확인되지 않았으므로 단정하지 않는다', () => {
  assert.equal(duty('ismsp', { revenue: 99999, subjects: 99999999 }), 'verify')
})

test('적용되지 않는 상황이면 제외되고, 모르면 상황 확인 필요로 남는다', () => {
  assert.equal(result('prv-cctv', { cctv: false }).status, 'na')
  assert.equal(result('prv-cctv', {}, { 'prv-cctv': { value: 'yes' } }).status, 'needsFact')
})
test('사유 없는 제외는 부족으로 본다', () => {
  assert.equal(result('log-time', {}, { 'log-time': { value: 'na' } }).status, 'gap')
  assert.equal(result('log-time', {}, { 'log-time': { value: 'na', note: 'SaaS만 사용' } }).status, 'na')
})

test('증적: 유효하면 충족, 변경·만료되면 충족으로 인정하지 않는다', () => {
  const ws = workspace()
  ws.save('answers', { 'log-time': { value: 'yes' } })
  const status = (d = day) => assess(catalog, ws.load(), ws, d).checks.find((c) => c.check.id === 'log-time')!.status
  assert.equal(status(), 'noEvidence')
  const e = ws.addEvidence({ title: 'NTP', checks: ['log-time'], owner: '', collectedOn: day, validDays: 30 }, { name: 'ntp.txt', bytes: Buffer.from('ok') })
  assert.equal(status(), 'met')
  assert.equal(status('2026-12-26'), 'noEvidence')
  writeFileSync(join(ws.dir, 'evidence', e.file!), 'tampered')
  assert.equal(status(), 'noEvidence')
})
test('기술 점검 실패는 "예" 답변과 불일치로 표시되고, 통과는 자동 충족이 되지 않는다', () => {
  const { ws } = setup({}, { 'cry-transit': { value: 'yes' } })
  const f = { scanner: 'tls', target: 'x', rule: 'tls12', title: 't', checks: ['cry-transit'], at: 'x' }
  const status = () => assess(catalog, ws.load(), ws, day).checks.find((c) => c.check.id === 'cry-transit')!.status
  ws.save('findings', [{ ...f, status: 'fail' }])
  assert.equal(status(), 'conflict')
  ws.save('findings', [{ ...f, status: 'pass' }])
  assert.equal(status(), 'noEvidence')
})

test('ISMS만 고르면 80개 항목, ISMS-P는 101개 항목', () => {
  for (const [t, n] of [['isms', 80], ['ismsp', 101]] as const) {
    const { ws, data } = setup({}, {}, [t])
    assert.equal(assess(catalog, data, ws, day).frameworks[0]!.total, n)
  }
})
test('법적 의무의 부족은 같은 조건의 인증 요구보다 앞선다', () => {
  const { ws, data } = setup({ development: true }, { 'cry-transit': { value: 'no' }, 'dev-source': { value: 'no' } })
  const ids = assess(catalog, data, ws, day).checks.map((c) => c.check.id)
  assert.ok(ids.indexOf('cry-transit') < ids.indexOf('dev-source'))
})

test('처리 흐름: 근거 없는 주민등록번호와 상황 모순을 찾는다', () => {
  const { ws } = setup({ rrn: false, overseas: false })
  ws.save('flows', [{ id: 'f1', name: '채용', purpose: '채용', items: '이름, 주민등록번호', legalBasis: '동의', retention: '1년', destruction: '삭제', overseas: '미국 ATS' }])
  const issues = assess(catalog, ws.load(), ws, day).flowIssues.map((i) => i.basis)
  assert.ok(issues.includes('개인정보 보호법 제24조의2①'))
  assert.equal(issues.filter((b) => b === '입력 모순').length, 2)
})

test('잘못된 입력은 저장하지 않는다', () => {
  const ws = workspace()
  assert.throws(() => ws.save('profile', { facts: { nope: 1 } }), /없는 상황 항목/)
  assert.throws(() => ws.save('profile', { facts: { subjects: -1 } }), /형식/)
  assert.throws(() => ws.save('answers', { 'log-retention': { value: 'yes' } }), /숫자/)
  assert.throws(() => ws.save('answers', { 'log-time': { value: 3 } }), /yes/)
  assert.throws(() => ws.save('evidence', [{ id: 'x', title: 't', checks: ['log-time'], collectedOn: day, file: '../../etc/passwd' }]), /경로/)
  assert.throws(() => ws.save('evidence', [{ id: 'x', title: 't', checks: ['log-time'], collectedOn: day, link: 'javascript:alert(1)' }]), /http/)
})

test('답변이 바뀔 때만 시각을 찍고 이력을 남기며, 1년이 지난 답변은 재확인 대상으로 표시한다', () => {
  const { ws } = setup()
  ws.save('answers', { 'cry-password': { value: 'yes', at: '2000-01-01T00:00:00.000Z' } })
  const first = ws.load().answers['cry-password']!.at!
  assert.notEqual(first, '2000-01-01T00:00:00.000Z', '클라이언트가 보낸 시각은 무시')
  ws.save('answers', { 'cry-password': { value: 'yes', at: 'x' }, 'cry-transit': { value: 'no' } })
  assert.equal(ws.load().answers['cry-password']!.at, first, '바뀌지 않은 답변은 시각 유지')
  const log = readFileSync(join(ws.dir, 'changes.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  assert.deepEqual(log.map((l) => [l.check, l.from, l.to]), [['cry-password', null, 'yes'], ['cry-transit', null, 'no']])
  const later = new Date(Date.parse(first) + 400 * 86_400_000).toISOString().slice(0, 10)
  const r = assess(catalog, ws.load(), ws, later).checks.find((c) => c.check.id === 'cry-password')!
  assert.equal(r.answeredAt, first.slice(0, 10))
  assert.equal(r.stale, true)
  assert.equal(assess(catalog, ws.load(), ws, first.slice(0, 10)).checks.find((c) => c.check.id === 'cry-password')!.stale, false)
})

test('답변 이력: 쓰기 실패 시 이력을 남기지 않고, 빠진 점검이 든 옛 파일도 저장을 막지 않는다', () => {
  const { ws } = setup()
  ws.save('answers', { 'cry-password': { value: 'no' } })
  const log = () => (existsSync(join(ws.dir, 'changes.jsonl')) ? readFileSync(join(ws.dir, 'changes.jsonl'), 'utf8').trim().split('\n').length : 0)
  const before = log()
  chmodSync(ws.dir, 0o500)
  try { assert.throws(() => ws.save('answers', { 'cry-password': { value: 'yes' } })) } finally { chmodSync(ws.dir, 0o700) }
  assert.equal(log(), before, '실패한 저장은 이력에 없음')
  writeFileSync(join(ws.dir, 'answers.yaml'), 'removed-old-check:\n  value: "yes"\n')
  ws.save('answers', { 'cry-password': { value: 'yes' } })
  assert.equal(ws.load().answers['cry-password']!.value, 'yes')
})

test('재확인: 값 없는 답변·해당 없는 점검은 재확인 대상이 아니고, reconfirm으로 날짜를 갱신하며, 날짜는 한국 시간이다', () => {
  const { ws } = setup({ cctv: true })
  writeFileSync(join(ws.dir, 'answers.yaml'), [
    'cry-transit:\n  owner: 홍길동\n  at: "2024-01-01T00:00:00.000Z"',
    'prv-cctv:\n  value: "yes"\n  at: "2024-01-01T00:00:00.000Z"',
    'cry-password:\n  value: "yes"\n  at: "2025-11-25T23:30:00.000Z"',
    'cry-store:\n  value: "yes"\n  at: "01 Jan 2026"',
  ].join('\n') + '\n')
  const at = (id: string, day: string, data = ws.load()) => assess(catalog, data, ws, day).checks.find((c) => c.check.id === id)!
  assert.equal(at('cry-transit', '2026-11-26').stale, false, '값 없는 답변')
  assert.equal(at('cry-password', '2026-11-26').answeredAt, '2025-11-26', 'UTC 23:30은 한국 날짜로 다음 날')
  assert.equal(at('cry-password', '2026-11-26').stale, false, '딱 1년째 날은 아직 아님')
  assert.equal(at('cry-password', '2026-11-27').stale, true)
  assert.deepEqual([at('cry-store', '2026-11-26').answeredAt, at('cry-store', '2026-11-26').stale], [undefined, false], 'ISO가 아닌 시각은 무시')
  const noCctv = ws.load()
  noCctv.profile.facts.cctv = false
  assert.equal(at('prv-cctv', '2026-11-26', noCctv).stale, false, '해당 없음')
  const answers = ws.load().answers
  ws.save('answers', { ...answers, 'cry-password': { ...answers['cry-password']!, reconfirm: true } })
  assert.equal(at('cry-password', '2026-11-27').stale, false, '재확인하면 날짜 갱신')
  assert.equal(ws.load().answers['cry-password']!.reconfirm, undefined, 'reconfirm은 저장하지 않음')
  const last = readFileSync(join(ws.dir, 'changes.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).at(-1)
  assert.deepEqual([last.check, last.kind], ['cry-password', '재확인'])
  ws.save('answers', { ...ws.load().answers, 'cry-password': { ...ws.load().answers['cry-password']!, due: '2026-12-31' } })
  const due = readFileSync(join(ws.dir, 'changes.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).at(-1)
  assert.equal(due.due, '2026-12-31')
})

test('처리 흐름: 국외 이전·제3자 제공을 한 줄로만 적거나 법정 사항이 빠지면 알려 준다', () => {
  const { ws } = setup({ overseas: true, thirdParty: true })
  ws.save('flows', [
    { id: 'a', name: '상담', purpose: '상담', items: '이름', legalBasis: '계약', retention: '1년', destruction: '삭제', overseas: '미국', thirdParties: '보험사' },
    { id: 'b', name: '제휴', purpose: '제휴', items: '이름', legalBasis: '동의', retention: '1년', destruction: '삭제',
      transfers: [{ basis: 'consent', items: '이름', country: '일본', timing: '즉시', method: 'API', recipient: 'JP Co', contact: 'jp@x', purpose: '배송', retention: '1년' }],
      provisions: [{ basis: 'consent', recipient: '보험사', purpose: '보험 가입', items: '이름' }] },
  ])
  const issues = assess(catalog, ws.load(), ws, day).flowIssues.map((i) => `${i.flowId}: ${i.issue}`)
  assert.ok(issues.includes('a: 국외 이전을 한 줄로만 적었습니다'))
  assert.ok(issues.includes('a: 제3자 제공을 한 줄로만 적었습니다'))
  assert.ok(issues.includes('b: 국외 이전 1(JP Co)에 거부 방법·절차·효과이(가) 없습니다'))
  assert.ok(issues.includes('b: 제3자 제공 1(보험사)에 보유·이용 기간이(가) 없습니다'))
})
