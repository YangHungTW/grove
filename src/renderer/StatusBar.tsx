import { useStoreAll } from './useStore'
import { formatTokens, formatUsd, shortModel, sumUsage } from './usageFormat'

/**
 * The window's bottom bar: today's agent token/cost footprint.
 *
 * Left is the worktree you are looking at, in the same order you read it —
 * which model, what it has cost today, how full the conversation's context is.
 * Right is the day's total across every open worktree, so the number you are
 * actually billed for is on screen without hunting through cards.
 *
 * Nothing found means nothing shown. Not every agent records what it spent
 * (see core/agentUsage), so an empty reading is "no evidence", never "no cost",
 * and inventing a zero for an agent that keeps no log would be a lie the user
 * cannot see through.
 *
 * The bar's ROW is always there even when it has nothing to say. It sits in the
 * app grid above the panes, so appearing and disappearing would resize every
 * terminal underneath it — a SIGWINCH per agent every time the first usage of
 * the day lands, and again when the day rolls over. An empty bar costs one row
 * and moves nothing.
 */
export function StatusBar(): JSX.Element {
  const s = useStoreAll()
  const active = s.activeWorktreeId ? s.wtUsage.get(s.activeWorktreeId) : undefined
  const total = sumUsage(s.wtUsage.values())

  return (
    <footer id="statusbar">
      {active ? (
        <div className="status-group" title={usageDetail(active)}>
          <span className="status-model">{shortModel(active.model)}</span>
          <span className="status-sep">·</span>
          <span>
            {active.costUsd != null
              ? `≈ ${formatUsd(active.costUsd)} today`
              : `${formatTokens(
                  active.input + active.output + active.cacheRead + active.cacheWrite
                )} tok today`}
          </span>
          <span className="status-sep">·</span>
          <span>ctx {formatTokens(active.contextTokens)}</span>
          <span className="status-sep">·</span>
          <span className="status-dim">
            in {formatTokens(active.input)} / out {formatTokens(active.output)} / cache{' '}
            {formatTokens(active.cacheRead + active.cacheWrite)}
          </span>
        </div>
      ) : (
        <div className="status-group" />
      )}
      {total.worktrees > 1 && (
        <div
          className="status-group status-total"
          title={
            `All ${total.worktrees} worktrees today · ${total.sessions} session` +
            `${total.sessions === 1 ? '' : 's'}\n` +
            `${formatTokens(total.tokens)} tokens` +
            // Say it plainly when the dollar figure leaves real work out: an
            // agent with no price table still spent money, just not money we
            // can name.
            (total.unpriced > 0
              ? `\n${total.unpriced} worktree${total.unpriced === 1 ? '' : 's'} not in the cost ` +
                `(no price for their model)`
              : '')
          }
        >
          <span className="status-dim">all worktrees</span>
          <span>
            {total.costUsd != null
              ? `≈ ${formatUsd(total.costUsd)}`
              : `${formatTokens(total.tokens)} tok`}
          </span>
        </div>
      )}
    </footer>
  )
}

/** The breakdown behind the bar's summary, as a hover tooltip. */
function usageDetail(u: {
  sessions: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  costUsd: number | null
}): string {
  return (
    `Claude today · ${u.sessions} session${u.sessions === 1 ? '' : 's'}\n` +
    `in ${formatTokens(u.input)} · out ${formatTokens(u.output)} · ` +
    `cache read ${formatTokens(u.cacheRead)} · cache write ${formatTokens(u.cacheWrite)}` +
    (u.costUsd != null ? `\n≈ ${formatUsd(u.costUsd)} (estimated)` : '\nNo price for this model')
  )
}
