import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assess, type CheckResult } from '../src/assess.ts'
import { loadCatalog } from '../src/catalog.ts'
import type { Facts } from '../src/condition.ts'
import { Workspace, type Answer, type Target, type WorkspaceData } from '../src/workspace.ts'

export const catalog = loadCatalog()
export const day = '2026-11-25'

export function workspace(): Workspace {
  const ws = new Workspace(join(mkdtempSync(join(tmpdir(), 'op-')), 'w'), catalog)
  ws.init()
  return ws
}
export function setup(facts: Facts = {}, answers: Record<string, Partial<Answer>> = {}, targets: Target[] = ['pipa', 'ismsp', 'iso']): { ws: Workspace; data: WorkspaceData } {
  const ws = workspace()
  ws.save('profile', { targets, facts })
  ws.save('answers', answers)
  return { ws, data: ws.load() }
}
export function result(id: string, facts: Facts, answers: Record<string, Partial<Answer>> = {}): CheckResult {
  const { ws, data } = setup(facts, answers)
  return assess(catalog, data, ws, day).checks.find((c) => c.check.id === id)!
}
export function duty(id: string, facts: Facts): string {
  const { ws, data } = setup(facts)
  return assess(catalog, data, ws, day).obligations.find((o) => o.id === id)!.status
}
