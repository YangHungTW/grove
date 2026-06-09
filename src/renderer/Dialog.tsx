import { useState } from 'react'
import { useStore } from './useStore'
import { store, type ProjectView } from './store'

export function Dialog(): JSX.Element | null {
  const s = useStore()
  const d = s.dialog
  if (!d) return null

  const project = (): ProjectView | undefined =>
    'repoRoot' in d ? store.projects.get(d.repoRoot) : undefined
  const close = (): void => store.closeDialog()

  return (
    <div className="dialog-overlay" onClick={close}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        {d.kind === 'closeProject' && <CloseProject name={d.name} repoRoot={d.repoRoot} />}
        {d.kind === 'createWorktree' && (
          <CreateWorktree projectName={d.projectName} getProject={project} />
        )}
        {d.kind === 'removeWorktree' && (
          <RemoveWorktree branch={d.branch} folder={d.folder} wtId={d.wtId} getProject={project} />
        )}
        {d.kind === 'projectSettings' && <ProjectSettings name={d.name} repoRoot={d.repoRoot} />}
        {d.kind === 'renameSession' && <RenameSession id={d.id} title={d.title} />}
      </div>
    </div>
  )
}

function RenameSession({ id, title }: { id: string; title: string }): JSX.Element {
  const [value, setValue] = useState(title)
  const submit = (): void => {
    store.renameSession(id, value)
    store.closeDialog()
  }
  return (
    <>
      <h3 className="dialog-title">Rename tab</h3>
      <label className="dialog-field">
        <span>Name</span>
        <input
          autoFocus
          value={value}
          spellCheck={false}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
            else if (e.key === 'Escape') store.closeDialog()
          }}
        />
      </label>
      <div className="dialog-actions">
        <button className="btn-ghost" onClick={() => store.closeDialog()}>
          Cancel
        </button>
        <button className="btn-primary" disabled={!value.trim()} onClick={submit}>
          Rename
        </button>
      </div>
    </>
  )
}

function ProjectSettings({ name, repoRoot }: { name: string; repoRoot: string }): JSX.Element {
  const p = store.projects.get(repoRoot)
  const [create, setCreate] = useState(p?.hookCreate ?? '')
  const [remove, setRemove] = useState(p?.hookRemove ?? '')
  return (
    <>
      <h3 className="dialog-title">{name} — settings</h3>
      <p className="dialog-body">
        Per-project hooks. Run in a login shell when a worktree is created/removed — a command, a
        script path, or an agent (e.g. <code>agy -p &quot;/setup&quot;</code>). Placeholders:{' '}
        <code>{'{worktree}'}</code> <code>{'{branch}'}</code> <code>{'{repo}'}</code>.
      </p>
      <label className="dialog-field">
        <span>On create worktree</span>
        <input
          value={create}
          placeholder='./scripts/setup.sh {worktree}'
          spellCheck={false}
          onChange={(e) => setCreate(e.target.value)}
        />
      </label>
      <label className="dialog-field">
        <span>On remove worktree</span>
        <input
          value={remove}
          placeholder='rm -rf {worktree}/node_modules'
          spellCheck={false}
          onChange={(e) => setRemove(e.target.value)}
        />
      </label>
      <div className="dialog-actions">
        <button className="btn-ghost" onClick={() => store.closeDialog()}>
          Cancel
        </button>
        <button
          className="btn-primary"
          onClick={() => {
            store.updateProjectHooks(repoRoot, { hookCreate: create, hookRemove: remove })
            store.closeDialog()
          }}
        >
          Save
        </button>
      </div>
    </>
  )
}

function CloseProject({ name, repoRoot }: { name: string; repoRoot: string }): JSX.Element {
  return (
    <>
      <h3 className="dialog-title">Close project</h3>
      <p className="dialog-body">
        Remove <b>{name}</b> from the sidebar. The repository stays on disk — nothing is deleted, and
        you can re-open it any time. Its open sessions will be closed.
      </p>
      <div className="dialog-actions">
        <button className="btn-ghost" onClick={() => store.closeDialog()}>
          Cancel
        </button>
        <button
          className="btn-primary"
          onClick={() => {
            store.closeDialog()
            void store.removeProject(repoRoot)
          }}
        >
          Close project
        </button>
      </div>
    </>
  )
}

function CreateWorktree({
  projectName,
  getProject
}: {
  projectName: string
  getProject: () => import('./store').ProjectView | undefined
}): JSX.Element {
  const [branch, setBranch] = useState('')
  const submit = (): void => {
    const v = branch.trim()
    const p = getProject()
    if (!v || !p) return
    store.closeDialog()
    void store.createWorktree(p, v)
  }
  return (
    <>
      <h3 className="dialog-title">New worktree</h3>
      <p className="dialog-body">
        Creates a new branch and a linked git worktree in <b>{projectName}</b>, then opens it.
      </p>
      <label className="dialog-field">
        <span>Branch name</span>
        <input
          autoFocus
          value={branch}
          placeholder="e.g. feature/login"
          spellCheck={false}
          onChange={(e) => setBranch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
            else if (e.key === 'Escape') store.closeDialog()
          }}
        />
      </label>
      <div className="dialog-actions">
        <button className="btn-ghost" onClick={() => store.closeDialog()}>
          Cancel
        </button>
        <button className="btn-primary" disabled={!branch.trim()} onClick={submit}>
          Create worktree
        </button>
      </div>
    </>
  )
}

function RemoveWorktree({
  branch,
  folder,
  wtId,
  getProject
}: {
  branch: string
  folder: string
  wtId: string
  getProject: () => import('./store').ProjectView | undefined
}): JSX.Element {
  const [delBranch, setDelBranch] = useState(false)
  return (
    <>
      <h3 className="dialog-title">Remove worktree</h3>
      <p className="dialog-body">
        Removes the worktree folder <code>{folder}</code> and its open sessions. By default the
        branch <b>{branch}</b> is <b>kept</b> — your commits are safe.
      </p>
      <label className="dialog-check">
        <input type="checkbox" checked={delBranch} onChange={(e) => setDelBranch(e.target.checked)} />
        <span>
          Also delete branch <b>{branch}</b> <em>(git branch -D — unmerged commits are lost)</em>
        </span>
      </label>
      <div className="dialog-actions">
        <button className="btn-ghost" onClick={() => store.closeDialog()}>
          Cancel
        </button>
        <button
          className="btn-danger"
          onClick={() => {
            const p = getProject()
            store.closeDialog()
            if (p) void store.removeWorktree(p, wtId, delBranch)
          }}
        >
          {delBranch ? 'Remove + delete branch' : 'Remove worktree'}
        </button>
      </div>
    </>
  )
}
