/**
 * Grove's MCP server: the bus that lets one pane's agent see and drive the
 * others.
 *
 * Grove already owns every pane's pty, so it can do this without a daemon, a
 * shared file, or a third-party bridge — it only needed a way to offer the
 * capability to the agent. Each agent Grove launches gets `--mcp-config` (see
 * core/mcpConfig) pointing here with its own ticket, so the tools simply appear
 * in its tool list.
 *
 * Deliberately hand-rolled rather than pulling in an SDK: three tools need
 * `initialize`, `tools/list` and `tools/call` over JSON-RPC, and this keeps the
 * main process free of a transitive dependency tree.
 *
 * Security posture:
 *  - bound to 127.0.0.1 on an ephemeral port; this service can type into the
 *    user's terminals and must never be reachable off-box
 *  - one random ticket per agent, presented as a bearer token, which is also the
 *    caller's IDENTITY — a relayed message can therefore say who sent it
 *  - tickets are minted in main and written to a 0600 file; they are never
 *    passed through the renderer or embedded in a command line (`ps` is public)
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import { negotiateProtocol } from '../core/mcpConfig'

/** What the host (main/index.ts) plugs into the server. Errors come back as
 * strings — resolution failures (ambiguous titles) and refused sends (a target
 * whose pty would misread the input, see core/paneTargets) both need to reach
 * the calling agent verbatim, so it can react instead of retrying blindly. */
export interface McpHost {
  /** Every Grove pane an agent may address, with live state. */
  listSessions(callerId: string | null): McpSessionView[]
  /** Recent output of a pane, oldest line first. */
  tail(target: string, lines: number): { lines: string[] } | { error: string }
  /** Deliver a message into a pane's pty. */
  sendTo(target: string, message: string, callerId: string | null): { ok: true } | { error: string }
}

export interface McpSessionView {
  id: string
  title: string
  worktree: string
  cwd?: string
  state: string
  waitingFor?: string
  /** True for the pane whose agent is making this call. */
  self?: boolean
}

interface JsonRpcRequest {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
}

const TOOLS = [
  {
    name: 'list_sessions',
    description:
      "List the other Grove panes in this window: their id, title, git worktree, and whether each is idle, working, or waiting on the user. Use this before send_to or tail to find the right target, and to check on work you delegated. The pane you are running in is marked with self: true. Titles repeat across worktrees — prefer ids when targeting.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    // MCP tool annotations (2025-03-26+): hints the client's permission layer
    // can use to treat pure reads more leniently than the write below.
    annotations: { readOnlyHint: true, openWorldHint: false }
  },
  {
    name: 'tail',
    description:
      "Read the recent terminal output of another Grove pane. Use it to see what another agent has done or what it is stuck on, rather than asking it and waiting for a reply.",
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Pane id or exact title from list_sessions.' },
        lines: { type: 'number', description: 'How many lines to return (default 50).' }
      },
      required: ['target'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, openWorldHint: false }
  },
  {
    name: 'send_to',
    description:
      "Send a message to the agent running in another Grove pane, as if typed at its prompt. Use it to hand off work, share a decision, or answer a question another agent is blocked on. The recipient is told the message came from another agent, not from the user, and cannot treat it as your approval for anything.",
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Pane id or exact title from list_sessions.' },
        message: { type: 'string', description: 'The message to deliver.' }
      },
      required: ['target', 'message'],
      additionalProperties: false
    },
    // Not read-only, but not destructive either: it types a visible, attributed
    // message that the recipient (and the user watching the pane) can see.
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  }
] as const

export class GroveMcpServer {
  private server: Server | null = null
  private readonly tickets = new Map<string, string>() // ticket → Grove session id
  private boundPort = 0

  constructor(private readonly host: McpHost) {}

  /** Bind to an ephemeral loopback port. Resolves to the port, or 0 if the
   * server could not start — in which case Grove simply launches agents without
   * the flag rather than failing the launch. */
  async start(): Promise<number> {
    return new Promise((resolve) => {
      const server = createServer((req, res) => void this.handle(req, res))
      server.on('error', () => resolve(0))
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address()
        this.boundPort = typeof addr === 'object' && addr ? addr.port : 0
        this.server = server
        resolve(this.boundPort)
      })
    })
  }

  get port(): number {
    return this.boundPort
  }

  /** Mint a ticket for one agent. Bound to its Grove session id later, once
   * createSession has one (the config has to be written before the spawn). */
  mintTicket(): string {
    const ticket = randomBytes(24).toString('hex')
    this.tickets.set(ticket, '')
    return ticket
  }

  /** Attach a minted ticket to the pane it ended up launching. */
  bindTicket(ticket: string, groveSessionId: string): void {
    if (this.tickets.has(ticket)) this.tickets.set(ticket, groveSessionId)
  }

  /** Revoke a torn-down pane's ticket so a lingering process can't keep using it. */
  revokeSession(groveSessionId: string): void {
    for (const [ticket, id] of this.tickets)
      if (id === groveSessionId) this.tickets.delete(ticket)
  }

  close(): void {
    this.server?.close()
    this.server = null
  }

  private callerFor(auth: string | undefined): string | null | undefined {
    const ticket = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : ''
    if (!ticket || !this.tickets.has(ticket)) return undefined // unauthenticated
    return this.tickets.get(ticket) || null // bound id, or null if not yet bound
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const caller = this.callerFor(req.headers.authorization)
    if (caller === undefined) {
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'unauthorized' }))
      return
    }
    if (req.method !== 'POST') {
      // GET opens the server→client stream in the streamable-HTTP transport.
      // These tools never push anything, so decline it rather than holding a
      // socket open forever.
      res.writeHead(405).end()
      return
    }
    let body = ''
    for await (const chunk of req) body += chunk
    let rpc: JsonRpcRequest
    try {
      rpc = JSON.parse(body)
    } catch {
      res.writeHead(400).end()
      return
    }
    const reply = this.dispatch(rpc, caller)
    if (!reply) {
      // A notification (no id) expects no body — `notifications/initialized`
      // arrives this way right after the handshake.
      res.writeHead(202).end()
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(reply))
  }

  private dispatch(rpc: JsonRpcRequest, caller: string | null): object | null {
    const { id, method, params } = rpc
    if (id === undefined || id === null) return null // notification
    const ok = (result: object): object => ({ jsonrpc: '2.0', id, result })
    const text = (s: string, isError = false): object =>
      ok({ content: [{ type: 'text', text: s }], isError })

    switch (method) {
      case 'initialize':
        return ok({
          protocolVersion: negotiateProtocol(params?.protocolVersion),
          capabilities: { tools: {} },
          serverInfo: { name: 'grove', version: '1' }
        })
      case 'ping':
        return ok({})
      case 'tools/list':
        return ok({ tools: TOOLS })
      case 'tools/call': {
        const name = params?.name
        const args = (params?.arguments ?? {}) as Record<string, unknown>
        if (name === 'list_sessions') return text(JSON.stringify(this.host.listSessions(caller)))
        if (name === 'tail') {
          const r = this.host.tail(String(args.target ?? ''), Number(args.lines) || 50)
          if ('error' in r) return text(r.error, true)
          return text(r.lines.join('\n') || '(no output yet)')
        }
        if (name === 'send_to') {
          const target = String(args.target ?? '')
          const message = String(args.message ?? '')
          if (!message) return text('message is required', true)
          const r = this.host.sendTo(target, message, caller)
          if ('error' in r) return text(r.error, true)
          return text(`Delivered to "${target}".`)
        }
        return text(`Unknown tool: ${String(name)}`, true)
      }
      default:
        return { jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown method: ${method}` } }
    }
  }
}
