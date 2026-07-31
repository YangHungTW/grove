/**
 * What a worktree card's path line should say.
 *
 * The card already shows its branch as the title, directly under a project
 * header showing the project's folder — and the default worktree template is
 * `../{repo}-wt-{branch}`, so the folder name is usually just those two strings
 * glued together. Printing it again puts the project name twice in adjacent
 * lines, which dilutes both and was the main thing crowding the project name in
 * the sidebar.
 */

/**
 * The folder name to show under `branch` on a card, or '' when the folder
 * carries nothing the card doesn't already say.
 *
 * Rather than matching the default template literally, this removes the parts
 * that ARE already on screen — the project folder and the branch, in whatever
 * order and with whatever separators a template glued them with — and hides the
 * line only when what remains is separators and an optional "wt" marker. A
 * hand-made worktree, a `{timestamp}` in the template, or any folder that
 * genuinely carries new information therefore still prints in full.
 */
export function cardPath(folder: string, projectFolder: string, branch: string): string {
  if (!folder) return ''
  // How expandWorktreeTemplate flattens a branch into one folder segment.
  const slug = branch.replace(/[^\w.-]/g, '_')
  const rest = [projectFolder, branch, slug]
    .filter(Boolean)
    .reduce((s, part) => s.split(part).join(''), folder)
  return /^[-_.]*(wt|worktree)?[-_.]*$/i.test(rest) ? '' : folder
}
