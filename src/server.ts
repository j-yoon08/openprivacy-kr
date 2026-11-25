import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { assess } from './assess.ts'
import { root, type Catalog } from './catalog.ts'
import { documentKinds, render, type DocumentKind } from './documents.ts'
import { loadLaw } from './law.ts'
import { renderReview, reviewSituation } from './review.ts'
import { InputError, today, type CollectionName, type Workspace } from './workspace.ts'

const assets: Record<string, [string, string]> = {
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
}
const editable = new Set<string>(['profile', 'answers', 'evidence', 'flows', 'risks', 'reviews'])
const reviewInput = z.strictObject({ title: z.string().default('제목 없음'), text: z.string().min(1).max(20_000), topics: z.record(z.string(), z.enum(['yes', 'no'])).default({}), conclusion: z.string().default(''), full: z.boolean().default(false) })
const uploadMeta = z.strictObject({
  title: z.string().min(1), checks: z.array(z.string()).min(1), owner: z.string().default(''), collectedOn: z.iso.date(),
  validDays: z.number().int().positive(), link: z.string().optional(), fileName: z.string().optional(), fileBase64: z.string().optional(),
})

/** 127.0.0.1에만 열고, Host와 토큰을 확인해 다른 웹사이트의 요청(DNS rebinding·CSRF)을 막습니다. */
export function createApp(ws: Workspace, catalog: Catalog): { server: Server; token: string } {
  const token = randomBytes(24).toString('hex')
  const server = createServer((req, res) => {
    handle(req, res).catch((e: unknown) => {
      if (res.headersSent) return void res.destroy()
      const input = e instanceof InputError || e instanceof z.ZodError || e instanceof SyntaxError
      if (!input) console.error(e)
      send(res, input ? 400 : 500, { error: e instanceof z.ZodError ? z.prettifyError(e) : input ? (e as Error).message : '내부 오류' })
    })
  })
  return { server, token }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const port = (server.address() as { port: number }).port
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host ?? '')) return send(res, 403, { error: '허용되지 않은 Host' })
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (req.method === 'GET' && url.pathname === '/') {
      // 토큰은 URL의 # 뒤로만 전달되어 로그·Referer에 남지 않습니다
      return raw(res, 'text/html; charset=utf-8', readFileSync(join(root, 'web', 'index.html')))
    }
    const asset = assets[url.pathname]
    if (req.method === 'GET' && asset) return raw(res, asset[1], readFileSync(join(root, 'web', asset[0])))
    if (!url.pathname.startsWith('/api/')) return send(res, 404, { error: '없는 주소' })
    const given = Buffer.from(String(req.headers['x-openprivacy-token'] ?? ''))
    const expected = Buffer.from(token)
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return send(res, 401, { error: '토큰이 없거나 맞지 않습니다. 터미널에 표시된 주소로 다시 여세요.' })

    const [, , kind, name] = url.pathname.split('/')
    if (req.method === 'GET' && kind === 'state') return send(res, 200, state())
    if (req.method === 'GET' && kind === 'documents' && name && Object.hasOwn(documentKinds, name)) {
      const [, ext] = documentKinds[name as DocumentKind]
      res.setHeader('content-disposition', `attachment; filename="${name}.${ext}"`)
      return raw(res, ext === 'csv' ? 'text/csv; charset=utf-8' : 'text/markdown; charset=utf-8', Buffer.from(render(name as DocumentKind, catalog, ws, today())))
    }
    if (req.method === 'PUT' && kind === 'data' && name && editable.has(name)) {
      ws.save(name as CollectionName, JSON.parse((await body(req, 4_000_000)).toString('utf8')))
      return send(res, 200, state())
    }
    if (req.method === 'GET' && kind === 'law') return send(res, 200, lawView())
    if (req.method === 'POST' && kind === 'review') {
      const input = reviewInput.parse(JSON.parse((await body(req, 200_000)).toString('utf8')))
      if (name !== 'document') return send(res, 200, reviewSituation(loadLaw(catalog), input.text, input.topics))
      return raw(res, 'text/markdown; charset=utf-8', Buffer.from(renderReview(catalog, ws, input, today(), input.full)))
    }
    if (req.method === 'POST' && kind === 'evidence') {
      const { fileName, fileBase64, ...meta } = uploadMeta.parse(JSON.parse((await body(req, 30_000_000)).toString('utf8')))
      ws.addEvidence(meta, fileName && fileBase64 ? { name: fileName, bytes: Buffer.from(fileBase64, 'base64') } : undefined)
      return send(res, 200, state())
    }
    send(res, 404, { error: '없는 주소' })
  }

  function lawView() {
    const { texts, provisions, topics } = loadLaw(catalog)
    return { texts, provisions, topics: topics.map(({ id, title, group, q }) => ({ id, title, group, q })) }
  }

  function state() {
    const data = ws.load()
    const day = today()
    return {
      today: day, data, assessment: assess(catalog, data, ws, day),
      evidenceStates: Object.fromEntries(data.evidence.map((e) => [e.id, ws.evidenceState(e, day)])),
      catalog: { factGroups: catalog.factGroups, sources: catalog.sources, documents: documentKinds },
    }
  }
}

function headers(res: ServerResponse): void {
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
  res.setHeader('referrer-policy', 'no-referrer')
  res.setHeader('content-security-policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
}
function raw(res: ServerResponse, type: string, content: Buffer): void {
  headers(res)
  res.writeHead(200, { 'content-type': type }).end(content)
}
function send(res: ServerResponse, code: number, value: unknown): void {
  headers(res)
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify(value))
}
async function body(req: IncomingMessage, max: number): Promise<Buffer> {
  const parts: Buffer[] = []
  let size = 0
  for await (const c of req as AsyncIterable<Buffer>) {
    size += c.length
    if (size > max) throw new InputError('파일이 너무 큽니다')
    parts.push(c)
  }
  return Buffer.concat(parts)
}
