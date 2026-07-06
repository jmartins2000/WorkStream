import { describe, expect, it, vi } from 'vitest'
import { CodexRpcError, JsonRpcEndpoint, OVERLOADED_CODE } from './rpc'

function makeEndpoint(): { rpc: JsonRpcEndpoint; sent: Record<string, unknown>[] } {
  const sent: Record<string, unknown>[] = []
  const rpc = new JsonRpcEndpoint((line) => sent.push(JSON.parse(line)))
  return { rpc, sent }
}

describe('JsonRpcEndpoint', () => {
  it('omits the jsonrpc field and always sends params (codex dialect)', () => {
    const { rpc, sent } = makeEndpoint()
    void rpc.request('initialize', { clientInfo: { name: 'test' } })
    void rpc.request('account/read')
    rpc.notify('initialized')
    expect(sent[0]).toEqual({ id: 1, method: 'initialize', params: { clientInfo: { name: 'test' } } })
    // The server rejects requests without `params` — empty object required.
    expect(sent[1]).toEqual({ id: 2, method: 'account/read', params: {} })
    expect(sent[2]).toEqual({ method: 'initialized', params: {} })
    expect('jsonrpc' in sent[0]).toBe(false)
  })

  it('correlates responses to requests by id', async () => {
    const { rpc, sent } = makeEndpoint()
    const first = rpc.request('thread/start', { cwd: '/a' })
    const second = rpc.request('model/list')
    // Answer out of order.
    rpc.feed(`{"id":${sent[1].id as number},"result":{"data":["m1"]}}\n`)
    rpc.feed(`{"id":${sent[0].id as number},"result":{"thread":{"id":"thr_1"}}}\n`)
    await expect(second).resolves.toEqual({ data: ['m1'] })
    await expect(first).resolves.toEqual({ thread: { id: 'thr_1' } })
  })

  it('rejects with CodexRpcError on error responses', async () => {
    const { rpc, sent } = makeEndpoint()
    const req = rpc.request('turn/start', {})
    rpc.feed(
      JSON.stringify({ id: sent[0].id, error: { code: OVERLOADED_CODE, message: 'Server overloaded; retry later.' } }) + '\n'
    )
    await expect(req).rejects.toMatchObject({ code: OVERLOADED_CODE })
    await expect(req).rejects.toBeInstanceOf(CodexRpcError)
  })

  it('buffers partial lines across feeds', async () => {
    const { rpc, sent } = makeEndpoint()
    const req = rpc.request('thread/read', { threadId: 't' })
    const response = JSON.stringify({ id: sent[0].id, result: { ok: true } }) + '\n'
    rpc.feed(response.slice(0, 10))
    rpc.feed(response.slice(10))
    await expect(req).resolves.toEqual({ ok: true })
  })

  it('dispatches notifications to named and catch-all handlers', () => {
    const { rpc } = makeEndpoint()
    const named = vi.fn()
    const all = vi.fn()
    rpc.onNotification('item/agentMessage/delta', named)
    rpc.onAnyNotification(all)
    rpc.feed('{"method":"item/agentMessage/delta","params":{"delta":"hi"}}\n')
    rpc.feed('{"method":"turn/completed","params":{"turn":{}}}\n')
    expect(named).toHaveBeenCalledWith({ delta: 'hi' })
    expect(all).toHaveBeenCalledTimes(2)
  })

  it('answers server-initiated requests through the registered handler', async () => {
    const { rpc, sent } = makeEndpoint()
    rpc.onServerRequest('item/commandExecution/requestApproval', async (params) => {
      expect((params as { command: string }).command).toBe('rm -rf /tmp/x')
      return { decision: 'decline' }
    })
    rpc.feed(
      '{"id":"srv-1","method":"item/commandExecution/requestApproval","params":{"command":"rm -rf /tmp/x"}}\n'
    )
    await vi.waitFor(() => {
      expect(sent).toContainEqual({ id: 'srv-1', result: { decision: 'decline' } })
    })
  })

  it('rejects unknown server requests with method-not-found', async () => {
    const { rpc, sent } = makeEndpoint()
    rpc.feed('{"id":9,"method":"tool/unknownThing","params":{}}\n')
    await vi.waitFor(() => {
      expect(sent[0]).toMatchObject({ id: 9, error: { code: -32601 } })
    })
  })

  it('fails in-flight requests on close', async () => {
    const { rpc } = makeEndpoint()
    const req = rpc.request('thread/start', {})
    rpc.close('process died')
    await expect(req).rejects.toThrow('process died')
    await expect(rpc.request('x')).rejects.toThrow('closed')
  })
})
