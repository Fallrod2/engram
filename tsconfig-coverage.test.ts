import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { readdirSync } from 'node:fs'
import { dirname, join, posix, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * Three separate lots closed this hole one file at a time — `e2e/`, then
 * `scripts/`, then `api/` — each discovered by hand, each after the previous
 * one shipped. The pattern was never "these directories are missing", it was
 * "a TypeScript file outside every tsconfig is checked by nothing, and says
 * nothing about it". This is the guard for the pattern rather than for its
 * instances: every tracked TypeScript file must belong to a program that
 * `bun run typecheck` actually runs.
 *
 * Both halves matter, so both are derived rather than listed here:
 *   - the set of programs comes from `package.json`'s typecheck chain, so a
 *     project wired into a tsconfig but never invoked does not count as
 *     coverage;
 *   - the set of files comes from `git ls-files`, so a file added tomorrow is
 *     in scope the moment it is tracked.
 *
 * A hardcoded list on either side would just be a fourth instance of the bug.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)))

type PackageJson = {
  workspaces?: string[]
  scripts?: Record<string, string>
}

function readPackageJson(dir: string): PackageJson {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as PackageJson
}

const rootPkg = readPackageJson(repoRoot)
const scripts = rootPkg.scripts ?? {}

/** Workspace directories, expanded from the `apps/*`-style globs. */
function workspaceDirs(): string[] {
  const dirs: string[] = []
  for (const pattern of rootPkg.workspaces ?? []) {
    const [parent, star] = pattern.split('/')
    if (star !== '*' || parent === undefined) {
      throw new Error(
        `Unsupported workspace glob ${pattern}: this test only expands "<dir>/*". Teach it the new shape.`,
      )
    }
    for (const entry of readdirSync(join(repoRoot, parent), { withFileTypes: true })) {
      if (entry.isDirectory()) dirs.push(posix.join(parent, entry.name))
    }
  }
  return dirs
}

/**
 * The tsconfig paths `bun run typecheck` really compiles, read out of the
 * chain itself. Anything the chain does that this cannot account for throws,
 * because a chain we cannot read is a chain we cannot vouch for.
 */
function projectsInTypecheckChain(): string[] {
  const chain = scripts.typecheck
  if (chain === undefined) throw new Error('No "typecheck" script in the root package.json.')

  const projects: string[] = []

  // `bun run --filter '*' typecheck` — every workspace that defines one.
  if (/--filter\s+'\*'\s+typecheck/.test(chain)) {
    for (const dir of workspaceDirs()) {
      const workspaceScript = readPackageJson(join(repoRoot, dir)).scripts?.typecheck
      if (workspaceScript === undefined) continue
      if (workspaceScript.trim() !== 'tsc --noEmit') {
        throw new Error(
          `Workspace ${dir} runs "${workspaceScript}" for typecheck; this test assumes ` +
            `"tsc --noEmit" so that the project is ${dir}/tsconfig.json. Teach it the new shape.`,
        )
      }
      projects.push(posix.join(dir, 'tsconfig.json'))
    }
  }

  // `bun run typecheck:<name>` — each delegating to a `tsc -p <project>`.
  const delegated = [...chain.matchAll(/bun run (typecheck:[\w-]+)/g)].map((m) => m[1] as string)
  for (const name of delegated) {
    const script = scripts[name]
    if (script === undefined) throw new Error(`Chain calls "${name}", which does not exist.`)
    const project = /^tsc -p (\S+)$/.exec(script.trim())?.[1]
    if (project === undefined) {
      throw new Error(
        `Script "${name}" is "${script}"; this test assumes "tsc -p <project>". Teach it the new shape.`,
      )
    }
    projects.push(project)
  }

  return projects
}

/** The files a tsconfig resolves through its include/exclude globs. */
function filesInProject(project: string): string[] {
  const configPath = join(repoRoot, project)
  const read = ts.readConfigFile(configPath, ts.sys.readFile)
  if (read.error) {
    throw new Error(
      `Cannot read ${project}: ${ts.flattenDiagnosticMessageText(read.error.messageText, ' ')}`,
    )
  }
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(configPath))
  if (parsed.errors.length > 0) {
    throw new Error(
      `Cannot resolve ${project}: ${parsed.errors
        .map((e) => ts.flattenDiagnosticMessageText(e.messageText, ' '))
        .join('; ')}`,
    )
  }
  return parsed.fileNames.map((f) => relative(repoRoot, f).split(/[\\/]/).join('/'))
}

/** Every TypeScript file git knows about. */
function trackedTypeScriptFiles(): string[] {
  const out = execFileSync('git', ['ls-files', '*.ts', '*.tsx', '*.mts', '*.cts'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  return out.split('\n').filter((line) => line.length > 0)
}

describe('typecheck coverage', () => {
  const projects = projectsInTypecheckChain()

  it('runs every tsconfig in the repo, so none is wired up but never invoked', () => {
    const declared = execFileSync('git', ['ls-files', '*tsconfig*.json'], {
      cwd: repoRoot,
      encoding: 'utf8',
    })
      .split('\n')
      .filter((line) => line.length > 0)
      // `tsconfig.base.json` is only ever extended, never compiled.
      .filter((line) => !line.endsWith('tsconfig.base.json'))

    expect([...declared].sort()).toEqual([...projects].sort())
  })

  it('leaves no tracked TypeScript file outside every program', () => {
    const covered = new Set(projects.flatMap(filesInProject))
    const orphans = trackedTypeScriptFiles().filter((file) => !covered.has(file))

    expect(orphans).toEqual([])
  })
})
