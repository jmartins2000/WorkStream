/**
 * JSON-RPC client for the Codex app-server protocol.
 *
 * Wire format (per codex-rs/app-server-protocol): newline-delimited JSON-RPC
 * 2.0 messages WITHOUT the "jsonrpc" field — `{id, method, params?}` for
 * requests, `{method, params?}` for notifications, `{id, result | error}` for
 * responses. The server also sends its own requests (approvals) that we must
 * answer, and notifications (streamed events).
 *
 * `JsonRpcEndpoint` is transport-agnostic (feed bytes in, lines come out via
 * a write callback) so the framing/correlation logic is unit-testable;
 * `CodexProcess` binds it to a spawned `codex app-server` child process.
 */

import { spawn, type ChildProcess } from 'node:child_process'

type JsonValue = unknown

export interface RpcError {
  code: number
  message: string
  data?: JsonValue
}

/** Error raised when the server answers a request with a JSON-RPC error. */
export class CodexRpcError extends Error {
  readonly code: number
  readonly data?: JsonValue
  constructor(error: RpcError) {
    super(error.message)
    this.name = 'CodexRpcError'
    this.code = error.code
    this.data = error.data
  }
}

/** JSON-RPC error code the server uses for backpressure ("retry later"). */
export const OVERLOADED_CODE = -32001

type NotificationHandler = (params: JsonValue) => void
type ServerRequestHandler = (params: JsonValue) => Promise<JsonValue>

interface Pending {
  resolve: (result: JsonValue) => void
  reject: (err: Error) => void
}

export class JsonRpcEndpoint {
  private nextId = 1
  private readonly pending = new Map<number, Pending>()
  private readonly notificationHandlers = new Map<string, NotificationHandler>()
  private readonly serverRequestHandlers = new Map<string, ServerRequestHandler>()
  /** Catch-all for notifications without a specific handler (event fan-out). */
  private anyNotificationHandler: ((method: string, params: JsonValue) => void) | null = null
  private buffer = ''
  private closed = false

  constructor(private readonly write: (line: string) => void) {}

  /** Feed raw stdout bytes; complete lines are parsed and routed. */
  feed(chunk: string | Buffer): void {
    this.buffer += chunk.toString()
    let newline: number
    while ((newline = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newline).trim()
      this.buffer = this.buffer.slice(newline + 1)
      if (line) this.routeLine(line)
    }
  }

  /** Send a request and await its response. The server rejects requests
   *  without a `params` field, so an empty object is sent when omitted. */
  request(method: string, params: JsonValue = {}): Promise<JsonValue> {
    if (this.closed) return Promise.reject(new Error('Codex connection is closed.'))
    const id = this.nextId++
    return new Promise<JsonValue>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.write(JSON.stringify({ id, method, params }))
    })
  }

  /** Send a notification (no response expected). */
  notify(method: string, params: JsonValue = {}): void {
    if (this.closed) return
    this.write(JSON.stringify({ method, params }))
  }

  /** Handle a named notification from the server. */
  onNotification(method: string, handler: NotificationHandler): void {
    this.notificationHandlers.set(method, handler)
  }

  /** Handle every notification (in addition to named handlers). */
  onAnyNotification(handler: (method: string, params: JsonValue) => void): void {
    this.anyNotificationHandler = handler
  }

  /** Handle a server-initiated request (e.g. approvals). Must return a result. */
  onServerRequest(method: string, handler: ServerRequestHandler): void {
    this.serverRequestHandlers.set(method, handler)
  }

  /** Fail all in-flight requests (process exited / stream closed). */
  close(reason = 'Codex connection closed.'): void {
    if (this.closed) return
    this.closed = true
    for (const [, pending] of this.pending) pending.reject(new Error(reason))
    this.pending.clear()
  }

  private routeLine(line: string): void {
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(line) as Record<string, unknown>
    } catch {
      console.warn('[codex-rpc] unparseable line:', line.slice(0, 200))
      return
    }

    const hasId = msg.id !== undefined && msg.id !== null
    if (hasId && msg.method === undefined) {
      // Response to one of our requests.
      const pending = this.pending.get(msg.id as number)
      if (!pending) return
      this.pending.delete(msg.id as number)
      if (msg.error) pending.reject(new CodexRpcError(msg.error as RpcError))
      else pending.resolve(msg.result)
      return
    }

    if (hasId && typeof msg.method === 'string') {
      // Server-initiated request — we must respond.
      void this.answerServerRequest(msg.id as number | string, msg.method, msg.params)
      return
    }

    if (typeof msg.method === 'string') {
      // Notification.
      this.anyNotificationHandler?.(msg.method, msg.params)
      this.notificationHandlers.get(msg.method)?.(msg.params)
    }
  }

  private async answerServerRequest(
    id: number | string,
    method: string,
    params: JsonValue
  ): Promise<void> {
    const handler = this.serverRequestHandlers.get(method)
    if (!handler) {
      this.write(
        JSON.stringify({
          id,
          error: { code: -32601, message: `Client does not handle ${method}` }
        })
      )
      return
    }
    try {
      const result = await handler(params)
      this.write(JSON.stringify({ id, result }))
    } catch (err) {
      this.write(
        JSON.stringify({
          id,
          error: { code: -32000, message: err instanceof Error ? err.message : String(err) }
        })
      )
    }
  }
}

/** A spawned `codex app-server` child wired to a JsonRpcEndpoint. */
export class CodexProcess {
  readonly rpc: JsonRpcEndpoint
  private readonly child: ChildProcess
  private exited = false

  constructor(binaryPath: string, onExit: (code: number | null) => void) {
    this.child = spawn(binaryPath, ['app-server'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env
    })
    this.rpc = new JsonRpcEndpoint((line) => {
      this.child.stdin?.write(line + '\n')
    })
    this.child.stdout?.on('data', (chunk: Buffer) => this.rpc.feed(chunk))
    this.child.stderr?.on('data', (chunk: Buffer) =>
      process.stderr.write(`[codex-server] ${chunk}`)
    )
    this.child.on('exit', (code) => {
      this.exited = true
      this.rpc.close(`codex app-server exited (code ${code}).`)
      onExit(code)
    })
    this.child.on('error', (err) => {
      this.exited = true
      this.rpc.close(`codex app-server failed to start: ${err.message}`)
      onExit(null)
    })
  }

  get alive(): boolean {
    return !this.exited
  }

  kill(): void {
    if (!this.exited) this.child.kill('SIGTERM')
  }
}
