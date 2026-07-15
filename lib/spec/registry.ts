/**
 * spec() registration helper + static registry scanner (F1.2, T12).
 *
 * A translated scenario embeds spec('<feature-key>/<slug>') in its test
 * title; the traceability meta-suite statically scans the test tree for
 * those literals and reconciles them against the parsed .feature.
 */
import fs from 'node:fs'
import path from 'node:path'

/** <feature-key>/<kebab-slug> with optional Examples row suffix #exN (1-based). */
export const SPEC_ID_RE = /^[a-z0-9_]+\/[a-z0-9][a-z0-9-]*(#ex[1-9][0-9]*)?$/

export function spec(id: string): string {
  if (!SPEC_ID_RE.test(id)) throw new Error(`Invalid spec id: ${id}`)
  return `[spec:${id}]`
}

const CALL_RE = /\bspec\(\s*['"]([^'"]+)['"]/g

/** Static scan — vitest runs files in isolated workers, so a runtime registry
 * cannot aggregate; the literal spec('...') call sites ARE the registry.
 * A file containing the pragma `spec-scan-ignore` is skipped — for test
 * files whose spec('...') literals are fixtures ABOUT the scanner, not
 * registrations (e.g. the registry's own test). */
export function scanSpecRegistrations(rootDir: string): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const e of fs.readdirSync(rootDir, { recursive: true, withFileTypes: true })) {
    if (!e.isFile() || !e.name.endsWith('.test.ts')) continue
    const parent = (e as unknown as { parentPath?: string; path: string }).parentPath ?? (e as unknown as { path: string }).path
    const src = fs.readFileSync(path.join(parent, e.name), 'utf8')
    if (src.includes('spec-scan-ignore')) continue
    for (const m of src.matchAll(CALL_RE)) {
      if (!out.has(m[1])) out.set(m[1], [])
      out.get(m[1])!.push(path.join(parent, e.name))
    }
  }
  return out
}
