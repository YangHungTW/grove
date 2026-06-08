import { useState } from 'react'
import { useStore } from './useStore'
import { store, type ProjectView, type WorktreeView } from './store'
import type { SessionSnapshot } from '../main/ipc'

export function Sidebar(): JSX.Element {
  const s = useStore()
  return (
    <aside id="sidebar">
      <button className="new-project" onClick={() => void store.openProject()}>
        + Open project…
      </button>
      <div className="section-label">Projects</div>
      {[...s.projects.values()].map((p) => (
        <ProjectItem key={p.repoRoot} project={p} />
      ))}
    </aside>
  )
}

function ProjectItem({ project }: { project: ProjectView }): JSX.Element {
  const s = useStore()
  const [adding, setAdding] = useState(false)
  const active = project.repoRoot === s.activeProjectId

  return (
    <div className={'project' + (active ? ' active' : '')}>
      <div className={'project-header' + (active ? ' active' : '')}>
        <button
          className="caret"
          onClick={(e) => {
            e.stopPropagation()
            store.toggleProjectExpand(project.repoRoot)
          }}
        >
          {project.expanded ? '▾' : '▸'}
        </button>
        <button className="project-title" onClick={() => void store.setActiveProject(project.repoRoot)}>
          {project.name}
        </button>
        <button
          className="row-x"
          title="remove from recent"
          onClick={(e) => {
            e.stopPropagation()
            void store.removeProject(project.repoRoot)
          }}
        >
          ×
        </button>
      </div>

      {project.expanded &&
        [...project.worktrees.values()].map((wt) => (
          <WorktreeItem key={wt.id} project={project} wt={wt} />
        ))}

      {project.expanded &&
        (adding ? (
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
        ) : (
          <button className="new-worktree" onClick={() => setAdding(true)}>
            + worktree
          </button>
        ))}
    </div>
  )
}

function WorktreeItem({ project, wt }: { project: ProjectView; wt: WorktreeView }): JSX.Element {
  const s = useStore()
  const isActive = project.repoRoot === s.activeProjectId && wt.id === s.activeWorktreeId
  const st = s.wtStatus.get(wt.id)
  const sessions = s.sessionsOf(wt.id)
  const cnt = sessions.length

  const statusParts: string[] = []
  const tip: string[] = []
  if (st) {
    if (st.dirty) {
      statusParts.push(`●${st.dirty}`)
      tip.push(`${st.dirty} uncommitted change${st.dirty > 1 ? 's' : ''}`)
    }
    if (st.ahead) {
      statusParts.push(`↑${st.ahead}`)
      tip.push(`${st.ahead} ahead`)
    }
    if (st.behind) {
      statusParts.push(`↓${st.behind}`)
      tip.push(`${st.behind} behind`)
    }
  }

  return (
    <>
      <div className={'wt-header' + (isActive ? ' active' : '')}>
        <button
          className="wt-title"
          onClick={() => store.selectWorktree(project.repoRoot, wt.id)}
        >
          ▾ {wt.branch || '(detached)'}
          {wt.primary ? ' ·main' : ''}
        </button>
        {statusParts.length > 0 && (
          <span className={'wt-status' + (st?.dirty ? ' dirty' : '')} title={tip.join(' · ')}>
            {statusParts.join(' ')}
          </span>
        )}
        {!isActive && cnt > 0 && (
          <span className={'wt-count' + (sessions.some((x) => s.pending.has(x.id)) ? ' attention' : '')}>
            {cnt}
          </span>
        )}
        {!wt.primary && (
          <button
            className="row-x"
            title="remove worktree"
            onClick={(e) => {
              e.stopPropagation()
              void store.removeWorktree(project, wt.id)
            }}
          >
            ×
          </button>
        )}
      </div>

      {isActive && (
        <>
          {sessions.map((sess) => (
            <SessionRow key={sess.id} session={sess} />
          ))}
          <div className="actions">
            {(['agent', 'shell'] as const).map((kind) => (
              <button key={kind} onClick={() => void store.addSession(wt.id, kind)}>
                + {kind}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  )
}

function SessionRow({ session }: { session: SessionSnapshot }): JSX.Element {
  const s = useStore()
  const line = s.lastLine.get(session.id)
  return (
    <div
      className={
        'session-row' +
        (session.id === s.focusedSessionId ? ' active' : '') +
        (s.pending.has(session.id) ? ' attention' : '')
      }
    >
      <div className="session-top">
        <span className={`dot dot-${session.state}`} />
        <button className="session-label" onClick={() => store.focusSession(session.id)}>
          {session.kind === 'agent' ? '★ ' : ''}
          {session.title}
        </button>
        <span className="session-state">{session.state}</span>
        <button className="row-x" onClick={() => store.closeSession(session.id)}>
          ×
        </button>
      </div>
      {line && <div className="session-line">{line}</div>}
    </div>
  )
}
