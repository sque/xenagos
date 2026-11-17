// The agent pane's terminal: Claude Code's own interface, from `claude attach` on the server's pseudo-terminal
// (design decision 4a). Output arrives as binary messages; keystrokes and size changes go back as JSON.

import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'

export type TerminalEnd = { kind: 'exit' } | { kind: 'unavailable'; reason: string } | { kind: 'lost' }

type Message = { type: 'exit' } | { type: 'unavailable'; reason: string }

export class AgentTerminal {
  private readonly term: Terminal
  private readonly fit = new FitAddon()
  private readonly socket: WebSocket
  private readonly observer: ResizeObserver
  private size = { cols: 0, rows: 0 }
  private ended = false

  constructor(
    host: HTMLElement,
    private readonly onEnd: (end: TerminalEnd) => void,
  ) {
    const style = getComputedStyle(document.documentElement)
    const color = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback
    this.term = new Terminal({
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 13,
      scrollback: 5000,
      theme: {
        background: color('--terminal-bg', '#0d1117'),
        foreground: color('--terminal-fg', '#e6edf3'),
      },
    })
    this.term.loadAddon(this.fit)
    this.term.open(host)
    this.fit.fit()
    this.size = { cols: this.term.cols, rows: this.term.rows }
    const url = new URL('/api/agent/terminal', location.href.replace(/^http/, 'ws'))
    url.searchParams.set('cols', String(this.term.cols))
    url.searchParams.set('rows', String(this.term.rows))
    this.socket = new WebSocket(url)
    this.socket.binaryType = 'arraybuffer'
    this.socket.onopen = () => {
      // The pane may have changed size while the connection opened.
      this.send({ type: 'resize', ...this.size })
    }
    this.socket.onmessage = (message) => {
      if (message.data instanceof ArrayBuffer) {
        this.term.write(new Uint8Array(message.data))
        return
      }
      const parsed = JSON.parse(String(message.data)) as Message
      this.end(parsed.type === 'unavailable' ? { kind: 'unavailable', reason: parsed.reason } : { kind: 'exit' })
    }
    this.socket.onclose = () => {
      this.end({ kind: 'lost' })
    }
    this.term.onData((data) => {
      this.send({ type: 'input', data })
    })
    this.observer = new ResizeObserver(() => {
      this.fitToHost()
    })
    this.observer.observe(host)
  }

  focus(): void {
    this.term.focus()
  }

  dispose(): void {
    this.ended = true
    this.observer.disconnect()
    this.socket.close()
    this.term.dispose()
  }

  private fitToHost(): void {
    if (this.ended) return
    this.fit.fit()
    const { cols, rows } = this.term
    if (cols === this.size.cols && rows === this.size.rows) return
    this.size = { cols, rows }
    this.send({ type: 'resize', cols, rows })
  }

  private send(message: unknown): void {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message))
  }

  private end(end: TerminalEnd): void {
    if (this.ended) return
    this.ended = true
    this.onEnd(end)
  }
}
