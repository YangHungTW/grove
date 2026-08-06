import { useState, type DragEvent, type MouseEvent } from 'react'
import { useStore } from './useStore'
import { store, type ProjectView, type WorktreeView } from './store'
import { formatTokens, formatUsd, shortModel } from './usageFormat'
import {
  RepoIcon,
  PlusIcon,
  GearIcon,
  XIcon,
  DiffIcon,
  MergeIcon,
  AnchorIcon,
  BoltIcon,
  ChevronDownIcon
} from './Icons'
import { slotAt, slotBefore, type DropSlot } from '../core/sidebarOrder'
import { cardPath } from '../core/cardPath'
import { timeAgo } from './timeAgo'
import type { PrInfo } from '../core/gh'
import groveLogo from './assets/grove-logo.svg'

/** In-flight sidebar drag, module-level (like GroupTabs') because the dragged
 * row and the row under the cursor are different components, and dataTransfer
 * can't be read during dragover. Exactly one is set at a time. */
let dragProject: string | null = null
let dragWt: { repoRoot: string; id: string } | null = null

/** Which edge of a row the cursor is on — the insertion line to draw. */
type Edge = 'top' | 'bottom' | null

/**
 * The insertion slot for a drag over a list container, measured from the rows
 * it actually rendered. Rows are found by `sel` and identified by `attr`, so the
 * container — not each row — owns hit testing, and the gaps between rows and the
 * space below the last one stay droppable.
 */
function slotIn(e: DragEvent<HTMLElement>, sel: string, attr: string): DropSlot | null {
  const rows = [...e.currentTarget.querySelectorAll<HTMLElement>(sel)].map((el) => {
    const r = el.getBoundingClientRect()
    return { id: el.getAttribute(attr) ?? '', top: r.top, height: r.height }
  })
  return slotAt(e.clientY, rows)
}

/** True once the drag has left `currentTarget` for good, rather than merely
 * crossed into one of its children — which fires dragleave on the parent too,
 * and would otherwise blink the insertion line off on every internal move. */
function reallyLeft(e: DragEvent<HTMLElement>): boolean {
  const to = e.relatedTarget
  return !(to instanceof Node) || !e.currentTarget.contains(to)
}

function edgeClass(edge: Edge): string {
  return edge ? ` drop-${edge}` : ''
}

/** The insertion line for `id`, when the slot is on that row. */
function slotClass(slot: DropSlot | null, id: string): string {
  return edgeClass(slot?.id === id ? slot.edge : null)
}

export function Sidebar(): JSX.Element {
  const s = useStore()
  const anyExpanded = s.anyProjectExpanded()
  // The list, not each header, hit-tests project drags: a group is as tall as
  // its expanded worktrees, so aiming at headers alone meant threading a ~28px
  // strip, and an insertion line under an expanded header drew *inside* the
  // group it was really landing after.
  const [slot, setSlot] = useState<DropSlot | null>(null)
  const canDropProject = (): boolean => dragProject !== null
  return (
    <aside id="sidebar">
      <div className="brand">
        <img className="brand-logo" src={groveLogo} alt="Grove" width={24} height={24} />
        <span className="brand-name">Grove</span>
      </div>
      <button className="new-project" onClick={() => void store.openProject()}>
        + Open project…
      </button>
      <div className="section-label">
        <span>Projects</span>
        {s.projects.size > 0 && (
          <button
            className="section-action"
            title={anyExpanded ? 'Collapse every project' : 'Expand every project'}
            onClick={() =>
              anyExpanded ? store.collapseAllProjects() : store.expandAllProjects()
            }
          >
            {anyExpanded ? 'Collapse all' : 'Expand all'}
          </button>
        )}
      </div>
      <div
        className="project-list"
        onDragOver={(e) => {
          if (!canDropProject()) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          setSlot(slotIn(e, '.project-group', 'data-repo'))
        }}
        onDragLeave={(e) => {
          if (reallyLeft(e)) setSlot(null)
        }}
        onDrop={(e) => {
          if (!canDropProject() || !dragProject) return
          e.preventDefault()
          const at = slotIn(e, '.project-group', 'data-repo')
          setSlot(null)
          if (at) store.reorderProject(dragProject, slotBefore(at, [...s.projects.keys()]))
          dragProject = null
        }}
      >
        {[...s.projects.values()].map((p) => (
          <ProjectGroup key={p.repoRoot} project={p} slot={slot} />
        ))}
      </div>
      <Elsewhere />
    </aside>
  )
}

/**
 * Claude sessions running on this machine that Grove does NOT own — started in
 * a plain terminal, or dispatched with `claude --bg`. Without this they are
 * completely invisible: an agent can be burning tokens (or holding the machine
 * awake) with nothing on screen to say so.
 *
 * Read-only by design, with one exception. A background session has a job id
 * and can be stopped; an interactive one is attached to somebody's terminal and
 * is that terminal's business, so it is listed and left alone.
 */
function Elsewhere(): JSX.Element | null {
  const s = useStore()
  const [open, setOpen] = useState(true)
  if (s.fleet.length === 0) return null
  return (
    <div className="elsewhere">
      <div className="section-label">
        <button className="elsewhere-toggle" onClick={() => setOpen((o) => !o)}>
          {open ? '▾' : '▸'} Elsewhere <span className="elsewhere-count">{s.fleet.length}</span>
        </button>
      </div>
      {open && (
        <ul className="elsewhere-list">
          {s.fleet.map((f) => (
            <li key={f.sessionId} className="elsewhere-row">
              <span
                className={`dot dot-${f.status}`}
                title={f.waitingFor ? `needs input — ${f.waitingFor}` : f.status}
              />
              <span className="elsewhere-name" title={f.cwd}>
                {f.name ?? f.sessionId.slice(0, 8)}
              </span>
              {f.kind === 'bg' && <span className="elsewhere-kind">bg</span>}
              {f.startedAt !== undefined && (
                <span className="elsewhere-age">{timeAgo(f.startedAt)}</span>
              )}
              {f.jobId && (
                <button
                  className="row-x"
                  title={`Stop this background session (claude stop ${f.jobId})`}
                  onClick={() => store.stopFleetSession(f.jobId!)}
                >
                  <XIcon size={12} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ProjectGroup({
  project,
  slot
}: {
  project: ProjectView
  slot: DropSlot | null
}): JSX.Element {
  const s = useStore()
  // Worktree cards are hit-tested by their container for the same reason
  // projects are — see Sidebar. Held here so the whole list shares one slot.
  const [cardSlot, setCardSlot] = useState<DropSlot | null>(null)
  // Collapsing hides the worktree cards, and with them their per-card attention
  // styling — so surface the aggregate on the header instead.
  const attention = [...project.worktrees.values()].filter((wt) =>
    s.worktreePending(wt.id)
  ).length
  // Read at event time, never at render: the drag state is module-level, so
  // nothing re-renders between dragstart and dragover — a value captured in the
  // render closure would still say "no drag in progress" and reject every drop.
  const canDropCard = (): boolean => dragWt !== null && dragWt.repoRoot === project.repoRoot
  return (
    <div
      className={
        'project-group' +
        (project.expanded ? '' : ' collapsed') +
        slotClass(slot, project.repoRoot)
      }
      data-repo={project.repoRoot}
    >
      <div
        className="project-header"
        draggable
        onDragStart={(e) => {
          dragProject = project.repoRoot
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', project.repoRoot)
        }}
        onDragEnd={() => {
          dragProject = null
        }}
      >
        <button
          className="project-caret"
          aria-expanded={project.expanded}
          title={project.expanded ? 'Collapse project' : 'Expand project'}
          onClick={() => store.toggleProjectExpand(project.repoRoot)}
        >
          <ChevronDownIcon size={12} />
        </button>
        <RepoIcon className="repo-icon" />
        <span className="project-name" title="Drag to reorder projects">
          {project.name}
        </span>
        {!project.expanded && attention > 0 && (
          <span className="project-attention" title={`${attention} need attention`}>
            {attention}
          </span>
        )}
        <span className="project-count">{project.worktrees.size}</span>
        <button
          className="proj-btn"
          title="New task — worktree + agent with a prompt, in one step"
          onClick={() =>
            store.openDialog({
              kind: 'newTask',
              repoRoot: project.repoRoot,
              projectName: project.name
            })
          }
        >
          <BoltIcon size={14} />
        </button>
        <button
          className="proj-btn"
          title="New worktree"
          onClick={() =>
            store.openDialog({
              kind: 'createWorktree',
              repoRoot: project.repoRoot,
              projectName: project.name
            })
          }
        >
          <PlusIcon size={14} />
        </button>
        <button
          className="proj-btn"
          title="Project settings (hooks)"
          onClick={() =>
            store.openDialog({
              kind: 'projectSettings',
              repoRoot: project.repoRoot,
              name: project.name
            })
          }
        >
          <GearIcon size={14} />
        </button>
        <button
          className="proj-btn"
          title="Close project (keeps the repo)"
          onClick={() =>
            store.openDialog({ kind: 'closeProject', repoRoot: project.repoRoot, name: project.name })
          }
        >
          <XIcon size={13} />
        </button>
      </div>

      {project.expanded && (
        <div
          className="worktrees"
          onDragOver={(e) => {
            if (!canDropCard()) return
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            setCardSlot(slotIn(e, '.card', 'data-wt'))
          }}
          onDragLeave={(e) => {
            if (reallyLeft(e)) setCardSlot(null)
          }}
          onDrop={(e) => {
            if (!canDropCard() || !dragWt) return
            e.preventDefault()
            const at = slotIn(e, '.card', 'data-wt')
            setCardSlot(null)
            if (at)
              store.reorderWorktree(
                project.repoRoot,
                dragWt.id,
                slotBefore(at, [...project.worktrees.keys()])
              )
            dragWt = null
          }}
        >
          {[...project.worktrees.values()].map((wt) => (
            <WorktreeCard
              key={wt.id}
              project={project}
              wt={wt}
              active={wt.id === s.activeWorktreeId}
              slot={cardSlot}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function WorktreeCard({
  project,
  wt,
  active,
  slot
}: {
  project: ProjectView
  wt: WorktreeView
  active: boolean
  slot: DropSlot | null
}): JSX.Element {
  const s = useStore()
  const st = s.wtStatus.get(wt.id)
  const line = s.worktreeLastLine(wt.id)
  const cnt = s.sessionsOf(wt.id).length
  const stateDot = s.worktreeState(wt.id)
  const waitingFor = s.worktreeWaitingFor(wt.id)
  const attention = s.worktreePending(wt.id)
  const durable = s.worktreeDurable(wt.id)
  // Blank whenever the folder just repeats the project header and the branch
  // above it — the common case with the default worktree template.
  const folder = cardPath(wt.path.split('/').filter(Boolean).pop() ?? '', project.name, wt.branch)

  const statusParts: string[] = []
  if (st?.dirty) statusParts.push(`●${st.dirty}`)
  if (st?.ahead) statusParts.push(`↑${st.ahead}`)
  if (st?.behind) statusParts.push(`↓${st.behind}`)

  return (
    <div
      className={
        'card' + (active ? ' active' : '') + (attention ? ' attention' : '') + slotClass(slot, wt.id)
      }
      data-wt={wt.id}
      draggable
      onClick={() => void store.selectWorktree(project.repoRoot, wt.id)}
      onDragStart={(e) => {
        // A worktree belongs to its repo, so cards only reorder within their
        // project — the container checks repoRoot before accepting the drop.
        dragWt = { repoRoot: project.repoRoot, id: wt.id }
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', wt.id)
      }}
      onDragEnd={() => {
        dragWt = null
      }}
    >
      <div className="card-top">
        {stateDot !== 'none' && (
          <span
            className={`dot dot-${stateDot}`}
            title={
              waitingFor
                ? `Agent: needs input — ${waitingFor}`
                : `Agent: ${stateDot === 'busy' ? 'working' : stateDot === 'waiting' ? 'needs input' : 'idle'}`
            }
          />
        )}
        <span className="card-title" title="Drag to reorder worktrees">
          {wt.branch || '(detached)'}
        </span>
        {durable && (
          <span
            className="card-durable"
            title="Durable — agent runs in tmux and survives a Grove restart"
          >
            <AnchorIcon size={11} />
          </span>
        )}
        {cnt > 0 && (
          <span className="card-count" title={`${cnt} session${cnt > 1 ? 's' : ''} open`}>
            {cnt}
          </span>
        )}
        {statusParts.length > 0 && (
          <span
            className={'wt-status' + (st?.dirty ? ' dirty' : '')}
            title={[
              st?.dirty ? `${st.dirty} uncommitted change${st.dirty > 1 ? 's' : ''}` : '',
              st?.ahead ? `${st.ahead} ahead` : '',
              st?.behind ? `${st.behind} behind` : ''
            ]
              .filter(Boolean)
              .join(' · ')}
          >
            {statusParts.join(' ')}
          </span>
        )}
        <PrBadge pr={s.wtPr.get(wt.id)} />
        <button
          className="row-review"
          aria-label="Review changes"
          title="Review changes (git diff)"
          onClick={(e) => {
            e.stopPropagation()
            void store.reviewWorktreeChanges(project.repoRoot, wt.id)
          }}
        >
          <DiffIcon size={12} />
        </button>
        {!wt.primary && (
          <button
            className="row-review"
            aria-label="Finish worktree"
            title="Finish: commit, then merge or open a PR"
            onClick={(e) => {
              e.stopPropagation()
              store.openDialog({
                kind: 'finishWorktree',
                repoRoot: project.repoRoot,
                wtId: wt.id,
                branch: wt.branch
              })
            }}
          >
            <MergeIcon size={12} />
          </button>
        )}
        {!wt.primary && (
          <button
            className="row-x"
            title="Remove worktree"
            onClick={(e) => {
              e.stopPropagation()
              store.openDialog({
                kind: 'removeWorktree',
                repoRoot: project.repoRoot,
                wtId: wt.id,
                branch: wt.branch,
                folder
              })
            }}
          >
            <XIcon size={12} />
          </button>
        )}
      </div>
      {folder && <div className="card-path">{folder}</div>}
      {/* An attention card is otherwise silent about what it actually wants.
          Claude reports the reason, so say it rather than making the user
          switch into the pane to find out. */}
      {waitingFor && <div className="card-waiting">waiting: {waitingFor}</div>}
      {line && <div className="card-sub">{line}</div>}
      <UsageLine wtId={wt.id} />
      <QuickRespond wtId={wt.id} />
    </div>
  )
}

/** PR + CI badge for a feature worktree's branch; click opens the PR. */
function PrBadge({ pr }: { pr?: PrInfo }): JSX.Element | null {
  if (!pr) return null
  const merged = pr.state === 'MERGED'
  const cls = merged ? 'merged' : pr.state === 'CLOSED' ? 'closed' : pr.checks
  const mark =
    merged || pr.checks === 'pass' ? '✓' : pr.checks === 'fail' ? '✗' : pr.checks === 'pending' ? '◷' : ''
  const detail =
    `PR #${pr.number} · ${pr.state.toLowerCase()}` +
    (pr.checks !== 'none' ? ` · checks ${pr.checks}` : '') +
    (pr.reviewDecision ? ` · review ${pr.reviewDecision.toLowerCase().replace(/_/g, ' ')}` : '')
  return (
    <button
      className={`pr-badge pr-${cls}`}
      title={detail}
      onClick={(e) => {
        e.stopPropagation()
        window.api.openExternal(pr.url)
      }}
    >
      #{pr.number}
      {mark && <span className="pr-mark">{mark}</span>}
    </button>
  )
}

/** Today's Claude token/cost footprint for this worktree (from transcripts). */
function UsageLine({ wtId }: { wtId: string }): JSX.Element | null {
  const s = useStore()
  const u = s.wtUsage.get(wtId)
  if (!u) return null
  const total = u.input + u.output + u.cacheRead + u.cacheWrite
  const detail =
    `Claude today · ${u.sessions} session${u.sessions > 1 ? 's' : ''}\n` +
    `in ${formatTokens(u.input)} · out ${formatTokens(u.output)} · ` +
    `cache read ${formatTokens(u.cacheRead)} · cache write ${formatTokens(u.cacheWrite)}` +
    (u.costUsd != null ? `\n≈ ${formatUsd(u.costUsd)} (estimated)` : '')
  return (
    <div className="card-usage" title={detail}>
      <span className="card-usage-model">{shortModel(u.model)}</span>
      <span>{u.costUsd != null ? `≈ ${formatUsd(u.costUsd)}` : `${formatTokens(total)} tok`}</span>
      <span>ctx {formatTokens(u.contextTokens)}</span>
    </div>
  )
}

/** Inline answer buttons for an agent stuck on an approval prompt: respond
 * without switching panes. "1" approves, "2" picks the second option, Esc
 * cancels — Claude's permission menus select on the bare keypress. */
function QuickRespond({ wtId }: { wtId: string }): JSX.Element | null {
  const s = useStore()
  const waiting = s.sessionsOf(wtId).find((x) => x.kind === 'agent' && x.state === 'waiting')
  if (!waiting) return null
  const send = (e: MouseEvent, data: string): void => {
    e.stopPropagation()
    store.quickRespond(waiting.id, data)
  }
  return (
    <div className="card-quick" onClick={(e) => e.stopPropagation()}>
      <span className="card-quick-label">{waiting.title}:</span>
      <button className="quick-yes" title="Send 1 (approve / first option)" onClick={(e) => send(e, '1')}>
        ✓ 1
      </button>
      <button title="Send 2 (second option)" onClick={(e) => send(e, '2')}>
        2
      </button>
      <button title="Send Esc (cancel / interrupt)" onClick={(e) => send(e, '\x1b')}>
        esc
      </button>
    </div>
  )
}
