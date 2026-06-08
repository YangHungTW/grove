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

  return (
    <div className="project-group">
      <div className="group-label">
        <span className="group-name">{project.name}</span>
        <button className="group-add" title="New worktree" onClick={() => setAdding(true)}>
          +
        </button>
        <button
          className="row-x"
          title="Remove from recent"
          onClick={() => void store.removeProject(project.repoRoot)}
        >
          ×
        </button>
      </div>

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
  const st = s.wtStatus.get(wt.id)
  const line = s.worktreeLastLine(wt.id)
  const cnt = s.sessionsOf(wt.id).length
  const stateDot = s.worktreeState(wt.id)
  const attention = s.worktreePending(wt.id)

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
        <span className="card-title">
          {wt.branch || '(detached)'}
          {wt.primary ? ' ·main' : ''}
        </span>
        {cnt > 0 && <span className="card-count">{cnt}</span>}
        {statusParts.length > 0 && (
          <span className={'wt-status' + (st?.dirty ? ' dirty' : '')}>{statusParts.join(' ')}</span>
        )}
        {!wt.primary && (
          <button
            className="row-x"
            title="Remove worktree"
            onClick={(e) => {
              e.stopPropagation()
              void store.removeWorktree(project, wt.id)
            }}
          >
            ×
          </button>
        )}
      </div>
      {line && <div className="card-sub">{line}</div>}
    </div>
  )
}
