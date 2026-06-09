import { useState } from 'react'
import { useStore } from './useStore'
import { store, type ProjectView, type WorktreeView } from './store'

export function Sidebar(): JSX.Element {
  const s = useStore()
  return (
    <aside id="sidebar">
      <button className="new-project" onClick={() => void store.openProject()}>
        + Open project…
      </button>
      <div className="section-label">Projects</div>
      {[...s.projects.values()].map((p) => (
        <ProjectGroup key={p.repoRoot} project={p} />
      ))}
    </aside>
  )
}

function ProjectGroup({ project }: { project: ProjectView }): JSX.Element {
  const s = useStore()
  const [adding, setAdding] = useState(false)
  const [closing, setClosing] = useState(false)

  return (
    <div className="project-group">
      <div className="group-label">
        <span className="group-name">{project.name}</span>
        <button className="group-add" title="New worktree" onClick={() => setAdding(true)}>
          +
        </button>
        <button
          className="row-x"
          title="Close project (keeps the repo on disk)"
          onClick={() => setClosing(true)}
        >
          ×
        </button>
      </div>

      {closing && (
        <div className="card-confirm" onClick={(e) => e.stopPropagation()}>
          <span>Close project? (repo kept)</span>
          <button
            className="confirm-yes"
            onClick={() => {
              setClosing(false)
              void store.removeProject(project.repoRoot)
            }}
          >
            Close
          </button>
          <button className="confirm-no" onClick={() => setClosing(false)}>
            Cancel
          </button>
        </div>
      )}

      {[...project.worktrees.values()].map((wt) => (
        <WorktreeCard key={wt.id} project={project} wt={wt} active={wt.id === s.activeWorktreeId} />
      ))}

      {adding && (
        <input
          className="wt-input"
          placeholder="new branch name, Enter to create"
          autoFocus
          onKeyDown={(e) => {
            const v = (e.target as HTMLInputElement).value.trim()
            if (e.key === 'Enter' && v) {
              void store.createWorktree(project, v)
              setAdding(false)
            } else if (e.key === 'Escape') setAdding(false)
          }}
        />
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
  const [confirming, setConfirming] = useState(false)
  const st = s.wtStatus.get(wt.id)
  const line = s.worktreeLastLine(wt.id)
  const cnt = s.sessionsOf(wt.id).length
  const stateDot = s.worktreeState(wt.id)
  const attention = s.worktreePending(wt.id)
  const folder = wt.path.split('/').filter(Boolean).pop() ?? ''

  const statusParts: string[] = []
  if (st?.dirty) statusParts.push(`●${st.dirty}`)
  if (st?.ahead) statusParts.push(`↑${st.ahead}`)
  if (st?.behind) statusParts.push(`↓${st.behind}`)

  return (
    <div
      className={'card' + (active ? ' active' : '') + (attention ? ' attention' : '')}
      onClick={() => void store.selectWorktree(project.repoRoot, wt.id)}
    >
      <div className="card-top">
        {stateDot !== 'none' && <span className={`dot dot-${stateDot}`} />}
        <span className="card-title">{wt.branch || '(detached)'}</span>
        {cnt > 0 && <span className="card-count">{cnt}</span>}
        {statusParts.length > 0 && (
          <span className={'wt-status' + (st?.dirty ? ' dirty' : '')}>{statusParts.join(' ')}</span>
        )}
        {!wt.primary && !confirming && (
          <button
            className="row-x"
            title="Remove worktree"
            onClick={(e) => {
              e.stopPropagation()
              setConfirming(true)
            }}
          >
            ×
          </button>
        )}
      </div>
      <div className="card-path">{folder}</div>
      {line && <div className="card-sub">{line}</div>}

      {confirming && (
        <div className="card-confirm" onClick={(e) => e.stopPropagation()}>
          <span>Remove this worktree?</span>
          <button
            className="confirm-yes"
            onClick={() => {
              setConfirming(false)
              void store.removeWorktree(project, wt.id)
            }}
          >
            Remove
          </button>
          <button className="confirm-no" onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}
