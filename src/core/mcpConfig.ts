/**
 * Grove's own MCP server, from the launch side.
 *
 * Grove owns the pty of every pane, so it is already the bus an agent would
 * need to see and drive its neighbours — it just had no way to offer that to
 * the agent. Claude Code takes `--mcp-config <file>`, and without
 * `--strict-mcp-config` those servers MERGE with the user's own rather than
 * replacing them, so Grove can hand each agent it launches a private endpoint
 * and the tools simply appear.
 *
 * Every agent gets its OWN ticket, which is both the credential and the
 * identity: the server maps a ticket back to the pane that presented it, so a
 * message relayed to another pane can say who sent it.
 *
 * Pure (no Node/Electron) so the config shape and the launch flag are testable
 * without binding a socket. Writing the file and minting tickets is main's job —
 * the ticket must never round-trip through the renderer as a value it could
 * read back for another pane.
 */

/** The `.mcp.json`-shaped config handed to one agent via `--mcp-config`. */
export interface McpConfigFile {
  mcpServers: {
    grove: {
      type: 'http'
      url: string
      headers: { Authorization: string }
    }
  }
}

/**
 * Config for one agent. Bound to 127.0.0.1: this is a loopback service holding
 * the ability to type into the user's terminals, and must never be reachable
 * off-box regardless of what the machine's firewall is doing.
 */
export function buildMcpConfig(port: number, ticket: string): McpConfigFile {
  return {
    mcpServers: {
      grove: {
        type: 'http',
        url: `http://127.0.0.1:${port}/mcp`,
        headers: { Authorization: `Bearer ${ticket}` }
      }
    }
  }
}

/**
 * The launch flag pointing at a written config file. Passed through
 * `buildAgentLaunch`'s `extraFlags` so it lands on every alternative of a
 * resume chain — see the note there about why this is not appended to the
 * finished command string.
 *
 * `--strict-mcp-config` is deliberately NOT set: it would drop the user's own
 * MCP servers for any agent Grove launches.
 */
export function mcpConfigFlag(configPath: string): string {
  return `--mcp-config ${configPath}`
}

/** MCP spec revisions this server can speak. */
const KNOWN_PROTOCOLS = new Set(['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'])
const DEFAULT_PROTOCOL = '2025-06-18'

/**
 * Which protocol revision to answer `initialize` with. These three tools use no
 * version-specific features, so echoing back whatever the client asked for is
 * both correct and the most compatible thing to do; an unrecognised request
 * falls back to a revision we know rather than parroting something arbitrary.
 */
export function negotiateProtocol(requested: unknown): string {
  return typeof requested === 'string' && KNOWN_PROTOCOLS.has(requested)
    ? requested
    : DEFAULT_PROTOCOL
}
