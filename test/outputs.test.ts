import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { csv, documentKinds, render, type DocumentKind } from '../src/documents.ts'
import { importProwler, mergeFindings, scanGithub, scanRepo, scanWeb, visibleText } from '../src/scanners.ts'
import { createApp } from '../src/server.ts'
import { catalog, day, setup } from './helpers.ts'

test('모든 문서가 빈 작업 폴더에서도 만들어진다', () => {
  const { ws } = setup()
  for (const k of Object.keys(documentKinds)) assert.ok(render(k as DocumentKind, catalog, ws, day).length > 20, k)
})
test('내부 관리계획은 법정 18개 장을 갖추고, 처리방침은 모르는 값을 지어내지 않는다', () => {
  const { ws } = setup()
  assert.equal(render('internal-plan', catalog, ws, day).match(/^## 제\d+장/gm)!.length, 18)
  assert.match(render('privacy-policy', catalog, ws, day), /【작성 필요: CPO】/)
})
test('처리방침은 해당 없다고 밝힌 절을 빼고 수탁자를 채운다', () => {
  const { ws } = setup({ orgName: '가나', overseas: false, cctv: false, outsourcing: true })
  ws.save('flows', [{ id: 'f', name: '배송', processors: '가나택배 | 배송' }])
  const md = render('privacy-policy', catalog, ws, day)
  assert.doesNotMatch(md, /국외 이전/)
  assert.match(md, /가나택배 \\\| 배송/)
})
test('국내에 주소가 없는 사업자의 처리방침은 국내대리인과 처리 국가를 담는다', () => {
  const md = (foreignOnly: boolean) => { const { ws } = setup({ foreignOnly }); return render('privacy-policy', catalog, ws, day) }
  assert.match(md(true), /## \d+\. 국내대리인[\s\S]*전자우편 주소[\s\S]*## \d+\. 개인정보를 처리하는 국가/)
  assert.doesNotMatch(md(false), /국내대리인|처리하는 국가/)
  const { ws } = setup({ foreignOnly: true, revenue: 10, domesticSubjects: 100, agentOrdered: false })
  const small = render('privacy-policy', catalog, ws, day)
  assert.doesNotMatch(small, /국내대리인/, '지정 의무가 없는 소규모 해외 사업자')
  assert.match(small, /처리하는 국가/)
})
test('처리방침은 국외 이전을 법정 사항별 열로 나눠 쓰고, 빠진 값은 작성 필요로 남긴다', () => {
  const { ws } = setup({ overseas: true })
  ws.save('flows', [{ id: 'b', name: '상담', transfers: [{ basis: 'contract', items: '이름', country: '미국', recipient: 'US Co', contact: 'us@x', purpose: '상담', retention: '1년' }] }])
  const md = render('privacy-policy', catalog, ws, day)
  assert.match(md, /\| 상담 \| 계약 이행을 위한 위탁·보관\(①3\) \| 이름 \| 미국 \| 【작성 필요: 시기·방법】 \| US Co \/ us@x \| 상담 \/ 1년 \| 【작성 필요: 거부 방법·절차·효과】 \|/)
})
test('운영명세서는 101행, SoA는 93행', () => {
  const { ws } = setup()
  const rows = (k: DocumentKind) => render(k, catalog, ws, day).split('\r\n').filter((l) => /^"(\d\.|A\.)/.test(l)).length
  assert.equal(rows('ismsp-statement'), 101)
  assert.equal(rows('soa'), 93)
})
test('운영명세서는 항목마다 고시 원문과 요건별 상태를 보여 준다', () => {
  const { ws } = setup()
  ws.save('answers', { 'acc-auth': { value: 'yes' }, 'acc-mfa': { value: 'no' } })
  const row = render('ismsp-statement', catalog, ws, day).split('\r\n').find((l) => l.startsWith('"2.5.3"'))!
  assert.match(row, /안전한 인증절차와 필요에 따라 강화된 인증방식/)
  assert.match(row, /\[부족\] 필요에 따라 강화된 인증방식 적용/)
})
test('CSV는 수식 실행을 막는다', () => {
  assert.match(csv([['=HYPERLINK("x")', '+1', -5]]), /"'=HYPERLINK\(""x""\)","'\+1","-5"/)
})

test('소스 점검은 위치만 남기고 값은 남기지 않는다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'op-src-'))
  const rrn = ['900101', '1234567'].join('-')
  writeFileSync(join(dir, 'a.py'), `x = 1\nu = "${rrn}"\nh = md5(password)\n`)
  writeFileSync(join(dir, 'b.txt'), 'order 991399-1234567\n')
  mkdirSync(join(dir, 'node_modules'))
  writeFileSync(join(dir, 'node_modules', 'c.py'), rrn)
  const out = scanRepo(dir)
  assert.equal(out.find((f) => f.rule === 'rrn')!.detail, 'a.py:2')
  assert.equal(out.find((f) => f.rule === 'weak-password-hash')!.status, 'fail')
  assert.equal(out.find((f) => f.rule === 'private-key')!.status, 'pass')
  assert.ok(!JSON.stringify(out).includes(rrn))
})
test('소스 점검은 카드번호(Luhn)·전화번호·하드코딩 비밀값을 찾고 자리표시자와 잠금 파일은 건너뛴다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'op-src-'))
  const card = ['4111', '1111', '1111', '1111'].join(' ')
  const secret = ['S3cr3t', 'Prod2024'].join('!')
  writeFileSync(join(dir, 'a.py'), `c = "${card}"\nbad = "4111 1111 1111 1112"\nt = 1795616857057\np = "010-1234-5678"\ndb_password = "${secret}"\napi_key = "\${API_KEY}"\npassword = "changeme123"\n`)
  writeFileSync(join(dir, 'pnpm-lock.yaml'), `x: 010-9999-8888\n`)
  const out = scanRepo(dir)
  const at = (rule: string) => out.find((f) => f.rule === rule)!
  assert.equal(at('card').detail, 'a.py:1')
  assert.equal(at('phone').detail, 'a.py:4')
  assert.equal(at('hardcoded-secret').detail, 'a.py:5')
  assert.ok(!JSON.stringify(out).includes(secret) && !JSON.stringify(out).includes(card))
})
test('소스 점검: camelCase·설정 파일·.env의 비밀값을 찾고, 숫자·경로·slug는 오탐하지 않는다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'op-src-'))
  const pw = ['S3cr3t', 'Prod2024'].join('!')
  writeFileSync(join(dir, 'a.ts'), [
    `const dbPassword = "${pw}"`, `db_password = "latest${pw}"`, 'private_key = "/etc/ssl/private/server.key"',
    'const pi = 3.1415926535897931', 'const ts = 1700000000000001', 'const t = "abc4111111111111111xyz"', 'const h = 0x01012345678',
    'const s = "sk-payment-processing-service-production"', `const g = "AIza${'A'.repeat(34)}-"`,
  ].join('\n'))
  writeFileSync(join(dir, 'app.properties'), `spring.datasource.password=${pw}\n`)
  writeFileSync(join(dir, 'values.yaml'), `aws-secret-access-key: wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY\n`)
  writeFileSync(join(dir, '.env.production'), `DB_PASSWORD=${pw}\nAPI_KEY=\${API_KEY}\n`)
  const out = Object.fromEntries(scanRepo(dir).map((f) => [f.rule, f.status === 'fail' ? f.detail : f.status]))
  assert.equal(out['hardcoded-secret'], 'a.ts:1, a.ts:2')
  assert.equal(out['config-secret'], '.env.production:1, app.properties:1')
  assert.equal(out['aws-secret'], 'values.yaml:1')
  assert.equal(out['service-token'], 'a.ts:9')
  assert.equal(out.card, 'pass')
  assert.equal(out.phone, 'pass')
})
test('웹 점검: HTTPS 전환·HSTS·쿠키·처리방침 표시를 판정한다', async () => {
  const res = (status: number, h: Record<string, string>, body = '', cookies: string[] = [], url = '') => {
    const r = new Response(body, { status, headers: h })
    for (const c of cookies) r.headers.append('set-cookie', c)
    return { status: r.status, url, headers: r.headers, body: r.body }
  }
  const run = (pages: Record<string, () => ReturnType<typeof res>>, target = 'shop.test') => scanWeb(target, async (u) => { const f = pages[u]; if (!f) throw new Error('refused'); return f() })
  const page = `<p>${'상품 '.repeat(80)}</p><script>var x = "<a>개인정보처리방침</a>"</script><a href="/p">개인정보 처리방침</a>`
  const out = await run({
    'http://shop.test/': () => res(301, { location: 'https://shop.test/?token=SECRET' }),
    'https://shop.test/': () => res(200, { 'strict-transport-security': 'max-age="31536000"; includeSubDomains' }, page, ['sid=1; Secure; HttpOnly', 'ab=2; Path=/; SecureFlag=0; HttpOnlyMode=x', 'eyJhbGciOi.SECRETJWT; Path=/']),
  })
  const by = Object.fromEntries(out.map((f) => [f.rule, f]))
  assert.deepEqual(Object.fromEntries(out.map((f) => [f.rule, f.status])), { 'https-redirect': 'pass', hsts: 'pass', 'cookie-secure': 'fail', 'cookie-httponly': 'unknown', 'privacy-policy-link': 'pass' })
  assert.equal(by['cookie-secure']!.detail, 'ab, (이름 없는 쿠키)')
  assert.ok(!JSON.stringify(out).includes('SECRET'), '쿠키 값과 주소의 쿼리를 기록하지 않음')

  const odd = await run({
    'http://shop.test/': () => res(302, { location: 'http://[::1' }),
    'https://shop.test/': () => res(403, { 'strict-transport-security': 'x-max-age=31536000' }, 'blocked'),
  })
  assert.deepEqual(Object.fromEntries(odd.map((f) => [f.rule, f.status])), { 'https-redirect': 'fail', hsts: 'fail', page: 'unknown' })
  const down = await run({ 'https://shop.test/': () => res(200, {}, page, [], 'http://shop.test/') })
  assert.equal(down.find((f) => f.rule === 'https-downgrade')!.status, 'fail')
  assert.equal(down.find((f) => f.rule === 'https-redirect')!.status, 'unknown')
  await assert.rejects(scanWeb('https://u:p@shop.test'), /도메인/)
  await assert.rejects(scanWeb('ftp://shop.test'), /도메인/)
  assert.equal((await run({ 'https://shop.test/': () => res(200, {}, page) }, 'HTTPS://shop.test'))[0]!.target, 'shop.test')
})
test('웹 점검의 화면 글 추출은 닫히지 않은 태그가 많아도 선형 시간이다', () => {
  const t = Date.now()
  visibleText('<script>'.repeat(250_000))
  visibleText('<'.repeat(2_000_000))
  visibleText('<a '.repeat(600_000))
  assert.ok(Date.now() - t < 1500, `${Date.now() - t}ms`)
  assert.equal(visibleText('<p>가</p><script>x</script><style>y</style>나').trim(), '가 나')
})
test('GitHub 점검: 권한이 없어 못 본 설정은 실패가 아니라 확인 불가', async () => {
  const bodies: Record<string, unknown> = { '': { default_branch: 'main' }, '/branches/main': { protected: false } }
  const out = await scanGithub('a/b', undefined, async (u) => {
    const p = u.replace('https://api.github.com/repos/a/b', '')
    return { status: p in bodies ? 200 : 403, json: async () => bodies[p] }
  })
  assert.deepEqual(Object.fromEntries(out.map((f) => [f.rule, f.status])), { 'branch-protection': 'fail', 'secret-scanning': 'unknown', 'push-protection': 'unknown', 'dependency-alerts': 'unknown' })
  await assert.rejects(scanGithub('../x', undefined), /owner\/repo/)
})
test('Prowler: 점검별로 모으고 계정 번호를 저장하지 않으며 계정별 결과를 따로 둔다', () => {
  const row = (status_code: string, uid: string) => ({ status_code, metadata: { event_code: 'iam_root_mfa' }, finding_info: { title: 'Root MFA' }, cloud: { provider: 'aws', account: { uid } }, unmapped: { compliance: { 'KISA-ISMS-P-2023': ['2.5.3'] } } })
  const a = importProwler([row('FAIL', '111122223333'), row('PASS', '111122223333'), row('MANUAL', '111122223333')], catalog)
  const b = importProwler([row('PASS', '444455556666')], catalog)
  assert.equal(a.length, 1)
  assert.equal(a[0]!.detail, '실패 1건, 통과 1건')
  assert.ok(a[0]!.checks.includes('acc-auth'))
  assert.ok(!JSON.stringify(a).includes('111122223333'))
  assert.equal(mergeFindings(a, b, 'prowler', b[0]!.target).length, 2)
})

test('로컬 서버: 토큰·Host가 틀리면 거부하고, 맞으면 저장한다', async () => {
  const { ws } = setup()
  const { server, token } = createApp(ws, catalog)
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as AddressInfo).port
  const call = (path: string, headers: Record<string, string> = {}, method = 'GET', payload?: string) =>
    new Promise<{ status: number; text: string }>((done, no) => {
      const r = request({ host: '127.0.0.1', port, path, method, headers }, (res) => { let t = ''; res.on('data', (c) => (t += c)).on('end', () => done({ status: res.statusCode!, text: t })) })
      r.on('error', no)
      r.end(payload)
    })
  const ok = { 'x-openprivacy-token': token }
  assert.equal((await call('/api/state')).status, 401)
  assert.equal((await call('/api/state', { ...ok, host: 'evil.example' })).status, 403)
  assert.equal((await call('/api/state', ok)).status, 200)
  assert.equal((await call('/../package.json', ok)).status, 404)
  assert.equal((await call('/api/data/findings', ok, 'PUT', '[]')).status, 404)
  assert.equal((await call('/api/data/profile', ok, 'PUT', '{bad')).status, 400)
  assert.equal((await call('/api/data/profile', ok, 'PUT', JSON.stringify({ targets: ['iso'], facts: { orgName: '가나' } }))).status, 200)
  assert.equal(ws.load().profile.facts.orgName, '가나')
  assert.equal((await call('/api/documents/constructor', ok)).status, 404)
  assert.ok(!(await call('/')).text.includes(token))
  server.close()
})
