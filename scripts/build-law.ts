/**
 * 국가법령정보센터 원문을 내려받아 catalog/law/*.json을 만듭니다.
 *   pnpm law:build   (별표 PDF 추출에 poppler의 pdftotext 필요)
 * 저작권법 제7조에 따라 법령·고시 원문은 보호받지 않는 저작물입니다.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const base = 'https://www.law.go.kr'
const out = join(import.meta.dirname, '..', 'catalog', 'law')
const ua = { 'user-agent': 'Mozilla/5.0 (compatible; openprivacy-kr)' }

async function get(url: string): Promise<Buffer> {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(url, { headers: ua }).catch(() => undefined)
    if (r?.ok) return Buffer.from(await r.arrayBuffer())
    await new Promise((f) => setTimeout(f, 2000))
  }
  throw new Error(`내려받기 실패: ${url}`)
}

const entities: Record<string, string> = { '&nbsp;': ' ', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&amp;': '&' }
function plain(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/g, '')
    .replace(/<br ?\/?>|<\/p>|<\/div>|<\/li>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&[a-z0-9#]+;/g, (m) => entities[m] ?? m)
    .replace(/[ \t\r ]+/g, ' ')
    .split('\n').map((l) => l.trim()).filter(Boolean).join('\n')
}

interface Article { id: string; chapter: string; title: string; text: string; deleted?: true; pending?: string; upcoming?: { effective: string; text: string } }
const tags = / ?<(?:개정|신설|전문개정|본조신설|제목개정|종전)[^>]*>/g

function articles(text: string, prefix: string): Article[] {
  const end = text.search(/부 칙 ?</)
  const body = end < 0 ? text : text.slice(0, end)
  const list: Article[] = []
  let chapter = ''
  let cur: Article | undefined
  for (const line of body.split('\n')) {
    const ch = /^제\d+(?:장|절)(?:의\d+)?\s/.exec(line)
    if (ch) { chapter = line.replace(tags, ''); cur = undefined; continue }
    const m = /^제(\d+)조(의\d+)?(?:\(([^)]*)\)| 삭제)/.exec(line)
    if (m) {
      cur = { id: `${prefix}제${m[1]}조${m[2] ?? ''}`, chapter, title: m[3] ?? '삭제', text: line.replace(tags, '') }
      if (m[3] === undefined) cur.deleted = true
      list.push(cur)
    } else if (cur && !/href=|체크박스|조문목록/.test(line)) {
      const p = /\[시행일: ?([\d. ]+)\] ?(.*)/.exec(line)
      if (p) cur.pending = `${p[2]} — ${p[1]!.trim()} 시행`
      cur.text += `\n${line.replace(tags, '')}`
    }
  }
  return list
}

function addenda(text: string): { title: string; text: string }[] {
  return text.split(/(?=부 칙 ?<[^>]*>)/).slice(1).map((s) => {
    const title = /^부 칙 ?<([^>]*)>/.exec(s)![1]!
    const body = s.slice(s.indexOf('>') + 1).split('\n').filter((l) => !/href=|체크박스|조문목록|^\[별표/.test(l)).join('\n').trim()
    return { title: `부칙 <${title.trim()}>`, text: body }
  }).filter((a) => a.text)
}

async function annexes(html: string): Promise<{ id: string; title: string; text: string }[]> {
  const list: { id: string; title: string; text: string }[] = []
  for (const seq of new Set([...html.matchAll(/flDownload\.do\?[^"']*?flSeq=(\d+)/g)].map((m) => m[1]!))) {
    const bin = await get(`${base}/LSW/flDownload.do?gubun=&flSeq=${seq}&bylClsCd=110201`)
    if (bin.subarray(0, 4).toString() !== '%PDF') continue
    const file = join(mkdtempSync(join(tmpdir(), 'byl-')), 'a.pdf')
    writeFileSync(file, bin)
    const text = execFileSync('pdftotext', ['-layout', '-enc', 'UTF-8', file, '-'], { encoding: 'utf8' }).replace(/\f/g, '\n').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim()
    const id = /[[【](별표(?: \d+(?:의\d+)?)?)[\]】]/.exec(text.slice(0, 120))?.[1]
    if (!id) continue
    const title = (text.split('\n').slice(0, 3).join(' ').replace(/\s+/g, ' ').match(/[\]】>] ?([^\]】>]*?관련\))/)?.[1] ?? id).trim()
    list.push({ id, title, text })
  }
  return list
}

const header = (t: string) => {
  const m = /\[시행 (\d+)\. (\d+)\. (\d+)\.\] \[([^\]]+)\]/.exec(t)
  if (!m) throw new Error('시행일을 찾지 못했습니다')
  return { effective: `${m[1]}-${m[2]!.padStart(2, '0')}-${m[3]!.padStart(2, '0')}`, version: m[4]!.split(',')[0]! }
}

interface Future { efYd: string; effectiveOf: (id: string) => string }
/** 법률 제21445호 부칙 제1조 단서: 2027-07-01. 나머지는 법률 제21910호(2026-09-08 공포, 6개월 경과 시행)입니다. */
const lawFuture: Future = { efYd: '20270701', effectiveOf: (id) => (id === '제32조의2' || id === '제75조' ? '2027-07-01' : '2027-03-09') }

async function law(name: string, prefix: string, future?: Future) {
  const page = (await get(`${base}/${encodeURIComponent('법령')}/${encodeURIComponent(name)}`)).toString('utf8')
  const seq = /lsiSeq\s*\?\s*lsiSeq\s*:\s*'(\d+)/.exec(page)![1]!
  const efYd = /efYd = '(\d{8})/.exec(page)![1]!
  const body = (ef: string) => get(`${base}/LSW/lsInfoR.do?lsiSeq=${seq}&chrClsCd=010202&urlMode=lsInfoP&efYd=${ef}&ancYnChk=0`).then((b) => b.toString('utf8'))
  const html = await body(efYd)
  const text = plain(html)
  const list = articles(text, prefix)
  const notes = addenda(text)
  if (future) {
    const raw = plain(await body(future.efYd))
    for (const a of addenda(raw)) if (!notes.some((n) => n.title === a.title)) notes.push({ ...a, title: `${a.title} (시행 예정)` })
    const current = new Map(list.map((a) => [a.id, a]))
    let last = 0
    for (const a of articles(raw, prefix)) {
      const now = current.get(a.id)
      if (now && now.text === a.text) { last = list.indexOf(now); continue }
      const eff = future.effectiveOf(a.id)
      if (now) { now.upcoming = { effective: eff, text: a.text }; last = list.indexOf(now) }
      else { list.splice(last + 1, 0, { ...a, text: '', upcoming: { effective: eff, text: a.text } }); last++ }
    }
  }
  return { ...header(text), articles: list, annexes: await annexes(html), addenda: notes }
}

async function notice(name: string, prefix: string) {
  const page = (await get(`${base}/${encodeURIComponent('행정규칙')}/${encodeURIComponent(name)}`)).toString('utf8')
  const seq = /admRulSeq:"(\d+)"/.exec(page)![1]!
  const html = (await get(`${base}/LSW/admRulInfoR.do?admRulSeq=${seq}&chrClsCd=010201&joTpYn=Y&languageType=KO`)).toString('utf8')
  const text = plain(html)
  return { ...header(text), articles: articles(text, prefix), annexes: await annexes(html), addenda: addenda(text) }
}

const sets = [
  ['law', '개인정보 보호법', () => law('개인정보보호법', '', lawFuture)],
  ['decree', '개인정보 보호법 시행령', () => law('개인정보보호법시행령', '영 ')],
  ['safeguard', '개인정보의 안전성 확보조치 기준', () => notice('개인정보의안전성확보조치기준', '기준 ')],
] as const
for (const [id, title, load] of sets) {
  const d = await load()
  writeFileSync(join(out, `${id}.json`), JSON.stringify({ id, title, fetchedOn: new Date().toISOString().slice(0, 10), ...d }, null, 1) + '\n')
  console.log(title, d.version, d.effective, '조', d.articles.filter((a) => !a.deleted && a.text).length, '삭제', d.articles.filter((a) => a.deleted).length, '예정', d.articles.filter((a) => a.upcoming).map((a) => a.id).join(','), '별표', d.annexes.map((a) => a.id).join(','), '부칙', d.addenda.length)
}
