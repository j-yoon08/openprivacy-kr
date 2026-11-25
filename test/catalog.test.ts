import assert from 'node:assert/strict'
import { test } from 'node:test'
import { catalog } from './helpers.ts'

test('세 기준의 모든 조항에 점검 항목이 하나 이상 연결된다', () => {
  const expected = { pipa: 57, ismsp: 101, iso: 118 }
  for (const fw of catalog.frameworks) {
    assert.equal(fw.requirements.length, expected[fw.id])
    const covered = new Set(catalog.checks.flatMap((c) => c.map[fw.id]))
    assert.deepEqual(fw.requirements.filter((r) => !covered.has(r.id)).map((r) => r.id), [])
  }
})

test('ISMS-P 영역별 항목 수는 16·64·21, ISO 부속서 A는 37·8·14·34', () => {
  const count = (fw: string, p: string) => catalog.frameworks.find((f) => f.id === fw)!.requirements.filter((r) => r.id.startsWith(p)).length
  assert.deepEqual(['1.', '2.', '3.'].map((p) => count('ismsp', p)), [16, 64, 21])
  assert.deepEqual(['A.5.', 'A.6.', 'A.7.', 'A.8.'].map((p) => count('iso', p)), [37, 8, 14, 34])
})

test('개선 방법은 완결된 문장이다(YAML 쉼표로 문장이 쪼개지지 않음)', () => {
  for (const c of catalog.checks) for (const f of c.fix) assert.match(f, /\.$/, `${c.id}: ${f}`)
})

test('법적 의무로 표시한 점검은 개인정보 보호법 조문에 연결된다', () => {
  for (const c of catalog.checks) if (c.legal) assert.ok(c.map.pipa.length, c.id)
})
