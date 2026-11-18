// The left column. Until the repository explorer (task 6.4) it lists the files the change touches, with the usual
// version-control letters, marks the file on screen, and opens a file when chosen.

import { useEffect, useState } from 'react'
import type { ChangedFile } from '../generated/types'

const LETTER: Record<ChangedFile['status'], string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  'type-changed': 'T',
}

export async function fetchChanges(): Promise<ChangedFile[]> {
  const response = await fetch('/api/changes')
  if (!response.ok) throw new Error(`the review server answered ${String(response.status)}`)
  return (await response.json()) as ChangedFile[]
}

export function Explorer({ current, onOpen }: { current: string | null; onOpen: ((path: string) => void) | null }) {
  const [files, setFiles] = useState<ChangedFile[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    fetchChanges().then(setFiles, (failure: unknown) => {
      setError(failure instanceof Error ? failure.message : String(failure))
    })
  }, [])
  return (
    <>
      <h2 className="columnhead">Changed files</h2>
      {error !== null && <p className="notice">{error}</p>}
      <ul className="files">
        {files?.map((file) => (
          <li key={file.path} aria-current={file.path === current ? 'true' : undefined}>
            <button
              type="button"
              disabled={onOpen === null || file.binary}
              title={file.oldPath != null ? `${file.oldPath} → ${file.path}` : file.path}
              onClick={() => onOpen?.(file.path)}
            >
              <span className={`path ${file.status}`}>{file.path}</span>
              <span className={`letter ${file.status}`}>{LETTER[file.status]}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}
