import { useStore } from './useStore'
import { store, type ProjectView, type WorktreeView } from './store'
import { RepoIcon, PlusIcon, GearIcon, XIcon } from './Icons'

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
  return (
    <div className="project-group">
      <div className="project-header">
        <RepoIcon className="repo-icon" />
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
        {stateDot !== 'none' && (
          <span
            className={`dot dot-${stateDot}`}
            title={`Agent: ${stateDot === 'busy' ? 'working' : stateDot === 'waiting' ? 'needs input' : 'idle'}`}
          />
        )}
        <span className="card-title">{wt.branch || '(detached)'}</span>
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
    </div>
  )
}
