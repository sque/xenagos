// What the walkthrough leaves out (spec: walkthrough-plan, "Coverage is visible"): the hunks no section claims, by
// category, with files and line counts. Choosing one opens its file at that hunk.

import type { CodeTarget, Coverage, HunkInfo, UncoveredFile } from '../generated/types'

const CATEGORY = { code: 'Code', tests: 'Tests', generated: 'Generated' } as const

export async function fetchCoverage(): Promise<Coverage | null> {
  const response = await fetch('/api/coverage')
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`the review server answered ${String(response.status)}`)
  return (await response.json()) as Coverage
}

/** Where a hunk is: its added lines at the head, or its removed lines at the base; null for a whole-file change
 * with no text lines (rename or mode only). */
export function hunkTarget(file: UncoveredFile, hunk: HunkInfo): CodeTarget | null {
  if (hunk.headCount > 0) {
    return { path: file.path, side: 'head', startLine: hunk.headStart, endLine: hunk.headStart + hunk.headCount - 1 }
  }
  if (hunk.baseCount > 0) {
    const path = file.oldPath ?? file.path
    return { path, side: 'base', startLine: hunk.baseStart, endLine: hunk.baseStart + hunk.baseCount - 1 }
  }
  return null
}

const counts = (added: number, removed: number) => `+${String(added)} −${String(removed)}`

export function NotCovered(props: {
  coverage: Coverage
  current: string | null
  onOpen: (file: UncoveredFile, hunk: HunkInfo) => void
}) {
  const { coverage, current, onOpen } = props
  if (coverage.hunks === 0) {
    return <p className="notcovered all">Every change is covered by a section.</p>
  }
  const hunks = `${String(coverage.hunks)} change${coverage.hunks === 1 ? '' : 's'}`
  const files = `${String(coverage.files)} file${coverage.files === 1 ? '' : 's'}`
  return (
    <section className="notcovered" aria-label="Not covered">
      <h3>
        Not covered <span className="count">{hunks} in {files}</span>
      </h3>
      {coverage.categories.map((group) => (
        <div key={group.category} className="group">
          <h4>
            {CATEGORY[group.category]} <span className="count">{counts(group.added, group.removed)}</span>
          </h4>
          <ul>
            {group.files.map((file) => (
              <li key={file.path} aria-current={file.path === current ? 'true' : undefined}>
                <button
                  type="button"
                  disabled={file.binary}
                  title={file.oldPath != null ? `${file.oldPath} → ${file.path}` : file.path}
                  onClick={() => {
                    const [first] = file.hunks
                    if (first !== undefined) onOpen(file, first)
                  }}
                >
                  <span className={`path ${file.status}`}>{file.path}</span>
                  <span className="count">{file.binary ? 'binary' : counts(file.added, file.removed)}</span>
                </button>
                {file.partly && <span className="partly">partly covered</span>}
                {file.hunks.length > 1 && !file.binary && (
                  <ol className="hunks">
                    {file.hunks.map((hunk, i) => (
                      <li key={hunk.id}>
                        <button
                          type="button"
                          aria-label={`${file.path}, change ${String(i + 1)} of ${String(file.hunks.length)}`}
                          onClick={() => {
                            onOpen(file, hunk)
                          }}
                        >
                          {i + 1}
                        </button>
                      </li>
                    ))}
                  </ol>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}
