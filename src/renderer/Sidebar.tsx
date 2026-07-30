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
import type { PrInfo } from '../core/gh'
import groveLogo from './assets/grove-logo.svg'

/** In-flight sidebar drag, module-level (like GroupTabs') because the dragged
 * row and the row under the cursor are different components, and dataTransfer
 * can't be read during dragover. Exactly one is set at a time. */
let dragProject: string | null = null
let dragWt: { repoRoot: string; id: string } | null = null

/** Which edge of a row the cursor is on — the insertion line to draw. */
type Edge = 'top' | 'bottom' | null

function edgeOf(e: DragEvent<HTMLElement>): Exclude<Edge, null> {
  const r = e.currentTarget.getBoundingClientRect()
  return e.clientY > r.top + r.height / 2 ? 'bottom' : 'top'
}

/**
 * The id to insert before for a drop on `targetId`: the target itself when the
 * cursor is on its top half, otherwise the row after it (undefined past the
 * last row = append). The bottom half matters — without it the last position is
 * unreachable, since every drop would land above something.
 */
function insertBefore(e: DragEvent<HTMLElement>, ids: string[], targetId: string): string | undefined {
  if (edgeOf(e) === 'top') return targetId
  return ids[ids.indexOf(targetId) + 1]
}

function edgeClass(edge: Edge): string {
  return edge ? ` drop-${edge}` : ''
}

export function Sidebar(): JSX.Element {
  const s = useStore()
  const anyExpanded = s.anyProjectExpanded()
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
      {[...s.projects.values()].map((p) => (
        <ProjectGroup key={p.repoRoot} project={p} />
      ))}
    </aside>
  )
}

function ProjectGroup({ project }: { project: ProjectView }): JSX.Element {
  const s = useStore()
  const [edge, setEdge] = useState<Edge>(null)
  // Collapsing hides the worktree cards, and with them their per-card attention
  // styling — so surface the aggregate on the header instead.
  const attention = [...project.worktrees.values()].filter((wt) =>
    s.worktreePending(wt.id)
  ).length
  // Read at event time, never at render: the drag state is module-level, so
  // nothing re-renders between dragstart and dragover — a value captured in the
  // render closure would still say "no drag in progress" and reject every drop.
  const canDrop = (): boolean => dragProject !== null && dragProject !== project.repoRoot
  return (
    <div className={'project-group' + (project.expanded ? '' : ' collapsed')}>
      <div
        className={'project-header' + edgeClass(edge)}
        data-repo={project.repoRoot}
        draggable
        onDragStart={(e) => {
          dragProject = project.repoRoot
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', project.repoRoot)
        }}
        onDragEnd={() => {
          dragProject = null
          setEdge(null)
        }}
        onDragOver={(e) => {
          if (!canDrop()) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          setEdge(edgeOf(e))
        }}
        onDragLeave={() => setEdge(null)}
        onDrop={(e) => {
          if (!canDrop() || !dragProject) return
          e.preventDefault()
          setEdge(null)
          store.reorderProject(
            dragProject,
            insertBefore(e, [...s.projects.keys()], project.repoRoot)
          )
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
        <div className="worktrees">
          {[...project.worktrees.values()].map((wt) => (
            <WorktreeCard
              key={wt.id}
              project={project}
              wt={wt}
              active={wt.id === s.activeWorktreeId}
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
  active
}: {
  project: ProjectView
  wt: WorktreeView
  active: boolean
}): JSX.Element {
  const s = useStore()
  const [edge, setEdge] = useState<Edge>(null)
  const st = s.wtStatus.get(wt.id)
  const line = s.worktreeLastLine(wt.id)
  const cnt = s.sessionsOf(wt.id).length
  const stateDot = s.worktreeState(wt.id)
  const attention = s.worktreePending(wt.id)
  const durable = s.worktreeDurable(wt.id)
  const folder = wt.path.split('/').filter(Boolean).pop() ?? ''

  const statusParts: string[] = []
  if (st?.dirty) statusParts.push(`●${st.dirty}`)
  if (st?.ahead) statusParts.push(`↑${st.ahead}`)
  if (st?.behind) statusParts.push(`↓${st.behind}`)

  // A worktree belongs to its repo, so cards only reorder within their project.
  // Evaluated at event time — see the note on ProjectGroup's canDrop.
  const canDrop = (): boolean =>
    dragWt !== null && dragWt.repoRoot === project.repoRoot && dragWt.id !== wt.id

  return (
    <div
      className={
        'card' + (active ? ' active' : '') + (attention ? ' attention' : '') + edgeClass(edge)
      }
      data-wt={wt.id}
      draggable
      onClick={() => void store.selectWorktree(project.repoRoot, wt.id)}
      onDragStart={(e) => {
        dragWt = { repoRoot: project.repoRoot, id: wt.id }
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', wt.id)
      }}
      onDragEnd={() => {
        dragWt = null
        setEdge(null)
      }}
      onDragOver={(e) => {
        if (!canDrop()) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setEdge(edgeOf(e))
      }}
      onDragLeave={() => setEdge(null)}
      onDrop={(e) => {
        if (!canDrop() || !dragWt) return
        e.preventDefault()
        setEdge(null)
        store.reorderWorktree(
          project.repoRoot,
          dragWt.id,
          insertBefore(e, [...project.worktrees.keys()], wt.id)
        )
        dragWt = null
      }}
    >
      <div className="card-top">
        {stateDot !== 'none' && (
          <span
            className={`dot dot-${stateDot}`}
            title={`Agent: ${stateDot === 'busy' ? 'working' : stateDot === 'waiting' ? 'needs input' : 'idle'}`}
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
      <div className="card-path">{folder}</div>
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
