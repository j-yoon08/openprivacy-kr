import { z } from 'zod'

export type FactValue = string | number | boolean
export type Facts = Record<string, FactValue | undefined>
/** 값을 몰라 참·거짓을 정할 수 없으면 'unknown'. 모름을 거짓으로 처리하면 의무를 놓치게 됩니다. */
export type Tri = boolean | 'unknown'

export type Condition =
  | { always: boolean }
  | { ref: string }
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | { fact: string; is: FactValue }
  | { fact: string; in: string[] }
  | { fact: string; gte: number }
  | { fact: string; gt: number }
  | { fact: string; lt: number }

export const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.strictObject({ always: z.boolean() }),
    z.strictObject({ ref: z.string() }),
    z.strictObject({ all: z.array(conditionSchema).min(1) }),
    z.strictObject({ any: z.array(conditionSchema).min(1) }),
    z.strictObject({ not: conditionSchema }),
    z.strictObject({ fact: z.string(), is: z.union([z.string(), z.number(), z.boolean()]) }),
    z.strictObject({ fact: z.string(), in: z.array(z.string()).min(1) }),
    z.strictObject({ fact: z.string(), gte: z.number() }),
    z.strictObject({ fact: z.string(), gt: z.number() }),
    z.strictObject({ fact: z.string(), lt: z.number() }),
  ]),
)

export type Conditions = Record<string, Condition>

export function evaluate(c: Condition, facts: Facts, named: Conditions): Tri {
  if ('always' in c) return c.always
  if ('ref' in c) return evaluate(named[c.ref]!, facts, named)
  if ('not' in c) {
    const v = evaluate(c.not, facts, named)
    return v === 'unknown' ? v : !v
  }
  if ('all' in c) {
    const vs = c.all.map((x) => evaluate(x, facts, named))
    return vs.includes(false) ? false : vs.includes('unknown') ? 'unknown' : true
  }
  if ('any' in c) {
    const vs = c.any.map((x) => evaluate(x, facts, named))
    return vs.includes(true) ? true : vs.includes('unknown') ? 'unknown' : false
  }
  const v = facts[c.fact]
  if (v === undefined || v === '') return 'unknown'
  if ('is' in c) return v === c.is
  if ('in' in c) return c.in.includes(String(v))
  if (typeof v !== 'number') return 'unknown'
  if ('gte' in c) return v >= c.gte
  if ('gt' in c) return v > c.gt
  return v < c.lt
}

/** 조건이 참조하는 fact 중 아직 입력하지 않은 것 */
export function missingFacts(c: Condition, facts: Facts, named: Conditions): string[] {
  const out = new Set<string>()
  const walk = (x: Condition): void => {
    if ('always' in x) return
    if ('ref' in x) return walk(named[x.ref]!)
    if ('not' in x) return walk(x.not)
    if ('all' in x) return x.all.forEach(walk)
    if ('any' in x) return x.any.forEach(walk)
    if (facts[x.fact] === undefined || facts[x.fact] === '') out.add(x.fact)
  }
  walk(c)
  return [...out]
}

export function* refs(c: Condition): Generator<{ ref?: string; fact?: string }> {
  if ('ref' in c) yield { ref: c.ref }
  else if ('not' in c) yield* refs(c.not)
  else if ('all' in c) for (const x of c.all) yield* refs(x)
  else if ('any' in c) for (const x of c.any) yield* refs(x)
  else if ('fact' in c) yield { fact: c.fact }
}
