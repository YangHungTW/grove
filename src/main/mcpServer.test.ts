import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { GroveMcpServer, type McpHost, type McpSessionView } from './mcpServer'

// The server is Electron-free (node:http + node:crypto only), so these drive the
// real JSON-RPC over a real loopback socket rather than mocking the transport —
// a handshake that is subtly wrong fails silently in Claude Code, with the tools
// just never appearing.

function makeHost(): McpHost & { sent: { target: string; message: string; from: string | null }[] } {
  const panes: McpSessionView[] = [
    { id: 's1', title: 'claude', worktree: '/wt/api', state: 'busy' },
    { id: 's2', title: 'claude 2', worktree: '/wt/ui', state: 'waiting', waitingFor: 'dialog open' }
  ]
  const sent: { target: string; message: string; from: string | null }[] = []
  return {
    sent,
    listSessions: (callerId) => panes.map((p) => ({ ...p, self: p.id === callerId || undefined })),
    tail: (target) => (target === 's1' ? ['line one', 'line two'] : null),
    sendTo: (target, message, from) => {
      if (target !== 's2') return false
      sent.push({ target, message, from })
      return true
    }
  }
}

describe('GroveMcpServer', () => {
  let server: GroveMcpServer
  let host: ReturnType<typeof makeHost>
  let port: number
  let ticket: string

  const rpc = async (body: object, auth = `Bearer ${ticket}`): Promise<Response> =>
    fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: auth },
      body: JSON.stringify(body)
    })

  const call = async (name: string, args: object = {}): Promise<string> => {
    const res = await rpc({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name, arguments: args } })
    return (await res.json()).result.content[0].text
  }

  beforeEach(async () => {
    host = makeHost()
    server = new GroveMcpServer(host)
    port = await server.start()
    ticket = server.mintTicket()
    server.bindTicket(ticket, 's1')
  })
  afterEach(() => server.close())

  it('binds to an ephemeral loopback port', () => {
    expect(port).toBeGreaterThan(0)
  })

  it('completes the initialize handshake, echoing a protocol it knows', async () => {
    const res = await rpc({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } }
    })
    const body = await res.json()
    expect(body.result.protocolVersion).toBe('2025-06-18')
    expect(body.result.capabilities.tools).toBeDefined()
    expect(body.result.serverInfo.name).toBe('grove')
  })

  it('falls back to a known protocol when asked for one it does not recognise', async () => {
    const res = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01' } })
    expect((await res.json()).result.protocolVersion).toBe('2025-06-18')
  })

  it('answers the post-handshake notification with no body', async () => {
    // A notification carries no id and must not get a JSON-RPC response.
    const res = await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' })
    expect(res.status).toBe(202)
    expect(await res.text()).toBe('')
  })

  it('advertises exactly the three tools', async () => {
    const res = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    const names = (await res.json()).result.tools.map((t: { name: string }) => t.name)
    expect(names).toEqual(['list_sessions', 'tail', 'send_to'])
  })

  it('marks the calling pane as self so an agent does not message itself', async () => {
    const sessions = JSON.parse(await call('list_sessions'))
    expect(sessions.find((s: McpSessionView) => s.id === 's1').self).toBe(true)
    expect(sessions.find((s: McpSessionView) => s.id === 's2').self).toBeUndefined()
  })

  it('returns another pane recent output', async () => {
    expect(await call('tail', { target: 's1' })).toBe('line one\nline two')
  })

  it('delivers a message and records who sent it', async () => {
    expect(await call('send_to', { target: 's2', message: 'schema is v2' })).toContain('Delivered')
    expect(host.sent).toEqual([{ target: 's2', message: 'schema is v2', from: 's1' }])
  })

  it('reports an unknown target as a tool error instead of silently succeeding', async () => {
    const res = await rpc({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'send_to', arguments: { target: 'nope', message: 'hi' } }
    })
    const body = await res.json()
    expect(body.result.isError).toBe(true)
    expect(body.result.content[0].text).toContain('list_sessions')
    expect(host.sent).toHaveLength(0)
  })

  describe('authentication', () => {
    it('rejects a request with no ticket', async () => {
      expect((await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, '')).status).toBe(401)
    })

    it('rejects a forged ticket', async () => {
      expect((await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, 'Bearer deadbeef')).status).toBe(401)
    })

    it('rejects a revoked ticket, so a lingering process loses access with its pane', async () => {
      server.revokeSession('s1')
      expect((await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).status).toBe(401)
    })
  })
})
