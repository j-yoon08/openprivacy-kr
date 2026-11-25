import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { parse } from 'yaml'
import { articleRefs, extractSanctions, loadLaw, sanctionsFor } from '../src/law.ts'
import { renderReview, reviewSituation, type Tier } from '../src/review.ts'
import { catalog, day, duty, result, setup } from './helpers.ts'

const book = loadLaw(catalog)
const of = (text: string, tier: Tier, topics: Record<string, 'yes' | 'no'> = {}) => reviewSituation(book, text, topics).items.filter((i) => i.tier === tier).map((i) => i.id)

test('법 125개, 시행령 126개, 기준 20개 현행 조문과 별표 7개가 모두 있다', () => {
  const n = (s: string, k: string) => book.provisions.filter((p) => p.source === s && p.kind === k && p.text).length
  assert.deepEqual([n('law', 'article'), n('decree', 'article'), n('safeguard', 'article')], [125, 126, 20])
  assert.deepEqual([n('decree', 'annex'), n('safeguard', 'annex')], [6, 1])
})
test('조문 번호가 이어져 있다(빠진 조문이 없다)', () => {
  for (const [s, p, max] of [['law', '', 76], ['decree', '영 ', 63], ['safeguard', '기준 ', 19]] as const) {
    const deleted = { law: [8], decree: [4, 8, 10, 20], safeguard: [] as number[] }[s] as number[]
    for (let i = 1; i <= max; i++) if (!deleted.includes(i)) assert.ok(book.byId.has(`${p}제${i}조`), `${p}제${i}조`)
  }
})
test('시행 예정 조문을 시행일과 함께 담는다', () => {
  assert.equal(book.byId.get('제28조의12')!.upcoming!.effective, '2027-03-09')
  assert.match(book.byId.get('제32조의2')!.upcoming!.text, /인증을 받아야 한다/)
  assert.doesNotMatch(book.byId.get('제32조의2')!.text, /인증을 받아야 한다/)
  assert.match(book.byId.get('영 제42조의2')!.pending!, /2027\. 2\. 20\./)
})
test('점검에 연결된 조문만 check 역할이고, 시행령은 모두 법 조문과 이어진다', () => {
  for (const p of book.provisions) if (p.source !== 'decree') assert.equal(p.role === 'check', p.checks.length > 0, p.id)
  assert.ok(book.byId.get('제34조')!.implementedBy.includes('영 제39조의2'))
})

test('제재: 준용 괄호는 위반 조문이 아니고, 범위는 펼친다', () => {
  const order = ['제15조', '제16조', '제17조', '제18조', '제26조', '제28조의5']
  assert.deepEqual(extractSanctions('제75조', '제75조(과태료) ① 다음은 과태료를 부과한다.\n1. 제15조부터 제17조까지(제26조제8항에 따라 준용되는 경우를 포함한다)를 위반한 자', order).map((x) => x.target), ['제15조', '제16조', '제17조'])
  assert.deepEqual(articleRefs('「신용정보의 이용 및 보호에 관한 법률」 제15조에 따른 정보와 제16조', order), ['제16조'])
})
test('제재: 실제 조문 연결', () => {
  const s = (id: string) => book.byId.get(id)!.sanctions.map((x) => `${x.article} ${x.item}`)
  assert.deepEqual(s('제29조'), ['제64조의2 ① 9호', '제75조 ② 5호'])
  assert.deepEqual(s('제19조'), ['제64조의2 ① 1호', '제71조 2호'])
  assert.deepEqual(s('제32조의2'), ['제75조 ② 15호'])
  assert.deepEqual(sanctionsFor(book, ['기준 제8조']).map((x) => x.article), ['제64조의2', '제75조'])
  assert.ok(result('log-retention', { subjects: 50000 }, { 'log-retention': { value: 1 } }).sanctions.length)
})

test('상황 검토는 어떤 글이든 모든 조문을 정확히 한 번씩 분류한다', () => {
  for (const t of ['해킹으로 유출', '점심 메뉴', '제34조', '「」<script>', 'ㅋㅋㅋ', '개인정보 '.repeat(500)]) {
    const ids = reviewSituation(book, t).items.map((i) => i.id)
    assert.equal(ids.length, book.provisions.length)
    assert.equal(new Set(ids).size, ids.length)
  }
})
test('상황별로 반드시 나와야 하는 조문', () => {
  const cases: [string, string[]][] = [
    ['랜섬웨어로 회원 DB가 유출된 것 같다', ['제29조', '제34조']],
    ['미국 SaaS로 상담 이력을 옮긴다', ['제28조의8', '제26조']],
    ['직원이 이웃 정보를 무단 조회했다', ['제59조', '제34조', '기준 제8조']],
    ['제휴사에서 받은 명단을 다른 용도로 쓰려 한다', ['제18조', '제19조']],
    ['초등학생 회원가입을 받는다', ['제22조의2']],
    ['사내 챗봇 학습데이터로 회원 문의를 쓴다', ['제28조의12', '제37조의2']],
    ['보호위원회 조사관이 자료제출을 요구했다', ['제63조']],
    ['회원이 탈퇴 후 삭제 요청을 했다', ['제36조', '제21조']],
  ]
  for (const [text, ids] of cases) {
    const direct = of(text, 'direct')
    for (const id of ids) assert.ok(direct.includes(id), `${text} → ${id}`)
  }
})
test('아니오라고 답하지 않은 점검·상황 조문은 나머지로 가지 않는다', () => {
  for (const text of ['전혀 관련 없는 글', '유출']) for (const i of reviewSituation(book, text).items) {
    const p = book.byId.get(i.id)!
    if (p.role === 'check' || p.role === 'situational') assert.notEqual(i.tier, 'rest', p.id)
  }
  const allNo = Object.fromEntries(book.topics.map((t) => [t.id, 'no' as const]))
  const r = reviewSituation(book, '유출', allNo)
  assert.equal(r.items.filter((i) => i.tier === 'direct' || i.tier === 'confirm').length, 0)
  assert.equal(r.overruled[0]!.title, '유출·침해사고')
})
test('현장 표현에서도 놓치면 안 되는 조문은 나머지로 가지 않는다', () => {
  const read = (f: string) => parse(readFileSync(new URL(f, import.meta.url), 'utf8')) as { text: string; must: string[] }[]
  const cases = [...read('./situations.yaml'), ...read('./situations-holdout.yaml')]
  for (const c of cases) {
    const tiers = new Map(reviewSituation(book, c.text).items.map((i) => [i.id, i.tier]))
    for (const id of c.must) assert.notEqual(tiers.get(id), 'rest', `${c.text} → ${id}`)
  }
})
test('세부 시행령과 제재가 함께 나온다', () => {
  const related = of('개인정보 유출 사고가 났다', 'related')
  for (const id of ['영 제39조', '영 제39조의2', '영 제40조', '제75조']) assert.ok(related.includes(id), id)
})
test('영문 약어는 낱말 안에서 찾지 않고, 주제는 직접 고를 수 있다', () => {
  assert.ok(!reviewSituation(book, 'email 주소').topics.some((t) => t.id === 'ai'))
  assert.ok(of('아무 설명 없음', 'direct', { cctv: 'yes' }).includes('제25조'))
  assert.ok(of('시행령 제32조를 확인', 'direct').includes('영 제32조'))
})
test('검토서는 직접 관련 조문 전문과 시행 예정 조문을 담고, 전체 포함이면 모든 조문이 들어간다', () => {
  const { ws } = setup({ overseas: true }, { 'prv-overseas': { value: 'no' } })
  const input = { title: 't', text: 'AI 학습에 쓰려고 미국으로 보낸다', topics: {} }
  const md = renderReview(catalog, ws, input, day, false)
  assert.match(md, /시행 예정\(2027-03-09\)/)
  assert.match(md, /\[부족\] 국외 이전의 적법 근거/)
  assert.doesNotMatch(md, /제7조의14\(운영 등\)/)
  const full = renderReview(catalog, ws, input, day, true)
  for (const p of book.provisions) if (p.kind === 'article' && p.text) assert.ok(full.includes(p.text.split('\n')[0]!.slice(0, 40).replace(/[<>]/g, (c) => `\\${c}`)), p.id)
})

test('새 의무: 국내대리인 1조원·100만명, 전송요구는 시행 전이면 확인 필요', () => {
  const agent = { foreignOnly: true, agentOrdered: false, domesticSubjects: 999999 }
  assert.equal(duty('domestic-agent', { ...agent, revenue: 9999 }), 'notRequired')
  assert.equal(duty('domestic-agent', { ...agent, revenue: 10000 }), 'required')
  assert.equal(duty('domestic-agent', { ...agent, revenue: 1, domesticSubjects: 1000000 }), 'required')
  const big = { revenue: 1801, school: false, hospital: false, subjects: 1000000, dataSender: false }
  assert.equal(duty('portability', { ...big, publicSystem: false }), 'verify')
  assert.equal(duty('portability', { ...big, publicSystem: true }), 'required')
  assert.equal(duty('portability', { ...big, revenue: 1800, publicSystem: false }), 'notRequired')
})
