import { useEffect, useState } from 'react'
import { useStore } from './useStore'
import { store, type ProjectView } from './store'
import { suggestBranch } from '../core/newTask'

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
        {d.kind === 'newTask' && <NewTask projectName={d.projectName} getProject={project} />}
        {d.kind === 'branchExists' && (
          <BranchExists projectName={d.projectName} branch={d.branch} getProject={project} />
        )}
        {d.kind === 'removeWorktree' && (
          <RemoveWorktree branch={d.branch} folder={d.folder} wtId={d.wtId} getProject={project} />
        )}
        {d.kind === 'projectSettings' && <ProjectSettings name={d.name} repoRoot={d.repoRoot} />}
        {d.kind === 'renameSession' && <RenameSession id={d.id} title={d.title} />}
        {d.kind === 'openFile' && <OpenFile worktreeId={d.worktreeId} />}
        {d.kind === 'finishWorktree' && (
          <FinishWorktree repoRoot={d.repoRoot} wtId={d.wtId} branch={d.branch} />
        )}
      </div>
    </div>
  )
}

function OpenFile({ worktreeId }: { worktreeId: string }): JSX.Element {
  const [path, setPath] = useState('')
  const open = (value: string): void => {
    const v = value.trim()
    if (!v) return
    store.closeDialog()
    void store.openPathOrUrl(worktreeId, v)
  }
  const browse = async (): Promise<void> => {
    const picked = await store.browseForFile(worktreeId)
    if (picked) setPath(picked)
  }
  return (
    <>
      <h3 className="dialog-title">Open file or URL</h3>
      <p className="dialog-body">
        Open a Markdown/HTML file (rendered, sanitized) or an http(s) URL (shown in an in-app frame,
        or your browser if the site blocks embedding). Paste to open immediately.
      </p>
      <label className="dialog-field">
        <span>File path or URL</span>
        <input
          autoFocus
          value={path}
          placeholder="/path/to/README.md  ·  https://example.com"
          spellCheck={false}
          onChange={(e) => setPath(e.target.value)}
          onPaste={(e) => {
            // Paste-to-open: open the pasted value straight away.
            const text = e.clipboardData.getData('text')
            if (text.trim()) {
              e.preventDefault()
              setPath(text)
              open(text)
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') open(path)
            else if (e.key === 'Escape') store.closeDialog()
          }}
        />
      </label>
      <div className="dialog-actions">
        <button className="btn-ghost" onClick={() => void browse()}>
          Browse…
        </button>
        <span style={{ flex: 1 }} />
        <button className="btn-ghost" onClick={() => store.closeDialog()}>
          Cancel
        </button>
        <button className="btn-primary" disabled={!path.trim()} onClick={() => open(path)}>
          Open
        </button>
      </div>
    </>
  )
}

function FinishWorktree({
  repoRoot,
  wtId,
  branch
}: {
  repoRoot: string
  wtId: string
  branch: string
}): JSX.Element {
  const [message, setMessage] = useState('')
  const [action, setAction] = useState<'merge' | 'pr' | 'commit'>('merge')
  const [removeAfter, setRemoveAfter] = useState(true)
  const [busy, setBusy] = useState(false)
  const [target, setTarget] = useState('main')
  // Fetch fresh values on open — the store's cached status can lag the agent's
  // latest writes by a polling interval.
  const [dirty, setDirty] = useState(store.wtStatus.get(wtId)?.dirty ?? 0)
  useEffect(() => {
    window.api
      .worktreeDefaultBranch(repoRoot)
      .then(setTarget)
      .catch(() => {})
    window.api
      .worktreeStatus(wtId)
      .then((st) => setDirty(st.dirty))
      .catch(() => {})
  }, [repoRoot, wtId])
  const canSubmit = !busy && (dirty === 0 || message.trim().length > 0)
  const submit = async (): Promise<void> => {
    if (!canSubmit) return
    setBusy(true)
    const ok = await store.finishWorktree({ repoRoot, wtId, branch, message, action, removeAfter })
    setBusy(false)
    if (ok) store.closeDialog()
  }
  return (
    <>
      <h3 className="dialog-title">Finish worktree</h3>
      <p className="dialog-body">
        Wrap up <b>{branch}</b>
        {dirty > 0 ? (
          <>
            : commit its <b>{dirty}</b> uncommitted change{dirty > 1 ? 's' : ''}, then
          </>
        ) : (
          ' —'
        )}{' '}
        merge it into <b>{target}</b> or push it and open a pull request.
      </p>
      {dirty > 0 && (
        <label className="dialog-field">
          <span>Commit message</span>
          <input
            autoFocus
            value={message}
            placeholder="e.g. feat: add login flow"
            spellCheck={false}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit()
              else if (e.key === 'Escape') store.closeDialog()
            }}
          />
        </label>
      )}
      <label className="dialog-check">
        <input
          type="radio"
          name="finish-action"
          checked={action === 'merge'}
          onChange={() => setAction('merge')}
        />
        <span>
          Merge into <b>{target}</b> <em>(local merge from the primary worktree)</em>
        </span>
      </label>
      <label className="dialog-check">
        <input
          type="radio"
          name="finish-action"
          checked={action === 'pr'}
          onChange={() => setAction('pr')}
        />
        <span>
          Push + create PR <em>(via the gh CLI)</em>
        </span>
      </label>
      <label className="dialog-check">
        <input
          type="radio"
          name="finish-action"
          checked={action === 'commit'}
          onChange={() => setAction('commit')}
        />
        <span>
          Commit only <em>(leave merging for later)</em>
        </span>
      </label>
      {action === 'merge' && (
        <label className="dialog-check">
          <input
            type="checkbox"
            checked={removeAfter}
            onChange={(e) => setRemoveAfter(e.target.checked)}
          />
          <span>
            Remove the worktree after merging <em>(deletes the merged branch too)</em>
          </span>
        </label>
      )}
      <div className="dialog-actions">
        <button className="btn-ghost" disabled={busy} onClick={() => store.closeDialog()}>
          Cancel
        </button>
        <button className="btn-primary" disabled={!canSubmit} onClick={() => void submit()}>
          {busy ? 'Working…' : 'Finish'}
        </button>
      </div>
    </>
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

function NewTask({
  projectName,
  getProject
}: {
  projectName: string
  getProject: () => ProjectView | undefined
}): JSX.Element {
  const agents = store.installedAgents()
  const [prompt, setPrompt] = useState('')
  const [branch, setBranch] = useState('')
  // Auto-suggest the branch from the prompt until the user edits it by hand.
  const [branchEdited, setBranchEdited] = useState(false)
  const [agentId, setAgentId] = useState(agents[0]?.id ?? '')
  const agent = agents.find((a) => a.id === agentId)
  const canSubmit = !!prompt.trim() && !!branch.trim() && !!agent
  const submit = (): void => {
    const p = getProject()
    if (!canSubmit || !p || !agent) return
    store.closeDialog()
    void store.startTask(p, branch.trim(), agent, prompt.trim())
  }
  return (
    <>
      <h3 className="dialog-title">New task</h3>
      <p className="dialog-body">
        One step: creates a branch + worktree in <b>{projectName}</b> and launches an agent there
        with your task as its first prompt.
      </p>
      <label className="dialog-field">
        <span>Task</span>
        <textarea
          autoFocus
          value={prompt}
          rows={3}
          placeholder="e.g. Fix the flaky login test and add a regression test"
          spellCheck={false}
          onChange={(e) => {
            setPrompt(e.target.value)
            if (!branchEdited) setBranch(suggestBranch(e.target.value))
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
            else if (e.key === 'Escape') store.closeDialog()
          }}
        />
      </label>
      <label className="dialog-field">
        <span>Branch</span>
        <input
          value={branch}
          placeholder="task/fix-flaky-login-test"
          spellCheck={false}
          onChange={(e) => {
            setBranch(e.target.value)
            setBranchEdited(true)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
            else if (e.key === 'Escape') store.closeDialog()
          }}
        />
      </label>
      {agents.length === 0 && (
        <p className="dialog-body">
          No agents installed — add one in <b>Settings → Agents</b> first.
        </p>
      )}
      {agents.length > 1 &&
        agents.map((a) => (
          <label key={a.id} className="dialog-check">
            <input
              type="radio"
              name="new-task-agent"
              checked={a.id === agentId}
              onChange={() => setAgentId(a.id)}
            />
            <span>{a.name}</span>
          </label>
        ))}
      <div className="dialog-actions">
        <button className="btn-ghost" onClick={() => store.closeDialog()}>
          Cancel
        </button>
        <button className="btn-primary" disabled={!canSubmit} onClick={submit}>
          {agents.length === 1 && agent ? `Start with ${agent.name}` : 'Start task'}
        </button>
      </div>
    </>
  )
}

function BranchExists({
  projectName,
  branch,
  getProject
}: {
  projectName: string
  branch: string
  getProject: () => ProjectView | undefined
}): JSX.Element {
  const use = (): void => {
    const p = getProject()
    store.closeDialog()
    if (p) void store.createWorktree(p, branch, true)
  }
  const rename = (): void => {
    const p = getProject()
    store.closeDialog()
    if (p) store.openDialog({ kind: 'createWorktree', repoRoot: p.repoRoot, projectName })
  }
  return (
    <>
      <h3 className="dialog-title">Branch already exists</h3>
      <p className="dialog-body">
        A branch named <b>{branch}</b> already exists in <b>{projectName}</b>. Open it as a new
        worktree, or pick a different name?
      </p>
      <div className="dialog-actions">
        <button className="btn-ghost" onClick={rename}>
          Choose another name
        </button>
        <button className="btn-primary" onClick={use}>
          Use existing branch
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
