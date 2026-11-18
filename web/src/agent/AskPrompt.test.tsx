import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { AskPrompt, describe as describeSelection, type Selection } from './AskPrompt'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const selection: Selection = { kind: 'code', path: 'app.py', startSide: 'head', startLine: 40, endSide: 'head', endLine: 52 }

function prompt(onClose = vi.fn(), onAsking = vi.fn()) {
  render(
    <AskPrompt at={{ selection, x: 200, y: 200 }} position={{ section: 3, step: 2 }} onAsking={onAsking} onClose={onClose} />,
  )
  return { onClose, onAsking, input: screen.getByRole('textbox') }
}

test('names the selection', () => {
  expect(describeSelection(selection)).toBe('app.py, lines 40–52')
  expect(describeSelection({ ...selection, startSide: 'base', endSide: 'base', endLine: 40 })).toBe(
    'app.py, line 40 (before the change)',
  )
  expect(describeSelection({ ...selection, startSide: 'base' })).toBe('app.py, line 40 (base) to 52 (head)')
  expect(describeSelection({ kind: 'element', visual: 'flow', element: 'retry' })).toBe('Visual flow, element retry')
})

test('sends the question with its selection and position on Enter', async () => {
  const fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ started: false, session: 's' }))))
  vi.stubGlobal('fetch', fetch)
  const { input, onClose, onAsking } = prompt()
  fireEvent.change(input, { target: { value: 'why is this guard needed?' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  await vi.waitFor(() => {
    expect(onClose).toHaveBeenCalledWith(true)
  })
  expect(onAsking).toHaveBeenCalledOnce()
  const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
  expect(url).toBe('/api/agent/ask')
  expect(JSON.parse(init.body as string)).toEqual({
    question: 'why is this guard needed?',
    selection,
    position: { section: 3, step: 2 },
  })
})

test('keeps the question and shows why it was not sent', async () => {
  const detail = 'The agent pane is not open. Open it, then send again.'
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ detail }), { status: 409 }))))
  const { input, onClose } = prompt()
  fireEvent.change(input, { target: { value: 'why?' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect((await screen.findByRole('alert')).textContent).toBe(detail)
  expect((input as HTMLTextAreaElement).value).toBe('why?')
  expect(onClose).not.toHaveBeenCalled()
})

test('closes on Escape and sends nothing empty', () => {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  const { input, onClose } = prompt()
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(fetch).not.toHaveBeenCalled()
  fireEvent.keyDown(input, { key: 'Escape' })
  expect(onClose).toHaveBeenCalledWith(false)
})
