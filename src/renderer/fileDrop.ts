/** Absolute paths of the files in a drag-and-drop transfer, resolved via the
 * preload's webUtils bridge. Empty (unresolvable) paths are dropped. Shared by
 * the terminal panes and the "+ file" button. */
export function filePathsFrom(dt: DataTransfer | null): string[] {
  if (!dt) return []
  return Array.from(dt.files)
    .map((f) => window.api.pathForFile(f))
    .filter(Boolean)
}
