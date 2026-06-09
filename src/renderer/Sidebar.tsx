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

const RepoIcon = (): JSX.Element => (
  <svg className="repo-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
    <path d="M4 1.5A1.5 1.5 0 0 0 2.5 3v10A1.5 1.5 0 0 0 4 14.5h9a.5.5 0 0 0 .5-.5V2.5A.5.5 0 0 0 13 2H4a.5.5 0 0 1 0-1h9A1.5 1.5 0 0 1 14.5 2.5v11a1.5 1.5 0 0 1-1.5 1.5H4A2.5 2.5 0 0 1 1.5 13V3A2.5 2.5 0 0 1 4 .5h.5v1H4Z" />
  </svg>
)

function ProjectGroup({ project }: { project: ProjectView }): JSX.Element {
  const s = useStore()
  return (
    <div className="project-group">
      <div className="project-header">
        <RepoIcon />
        <span className="project-name">{project.name}</span>
        <span className="project-count">{project.worktrees.size}</span>
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
          +
        </button>
        <button
          className="proj-btn"
          title="Close project (keeps the repo)"
          onClick={() =>
            store.openDialog({ kind: 'closeProject', repoRoot: project.repoRoot, name: project.name })
          }
        >
          ✕
        </button>
      </div>

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
            ×
          </button>
        )}
      </div>
      <div className="card-path">{folder}</div>
      {line && <div className="card-sub">{line}</div>}
    </div>
  )
}
