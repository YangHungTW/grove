/** Solid, monochrome SVG icons (fill = currentColor). No emoji. */
type P = { size?: number; className?: string }
const svg = (size: number, className: string | undefined, path: JSX.Element): JSX.Element => (
  <svg
    className={className}
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="currentColor"
    aria-hidden="true"
  >
    {path}
  </svg>
)

export const BellIcon = ({ size = 16, className }: P): JSX.Element =>
  svg(
    size,
    className,
    <path d="M8 1.5a1 1 0 0 1 1 1v.55a3.5 3.5 0 0 1 2.5 3.35v2.3l1 1.6V12H3.5v-1.7l1-1.6v-2.3A3.5 3.5 0 0 1 7 3.05V2.5a1 1 0 0 1 1-1Zm0 13a1.8 1.8 0 0 1-1.7-1.2h3.4A1.8 1.8 0 0 1 8 14.5Z" />
  )

export const GearIcon = ({ size = 16, className }: P): JSX.Element =>
  svg(
    size,
    className,
    <path d="M8 5.2A2.8 2.8 0 1 0 8 10.8 2.8 2.8 0 0 0 8 5.2Zm0 1.6a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4ZM7 .8h2l.3 1.7c.4.13.78.3 1.13.52l1.5-.86 1.4 1.4-.86 1.5c.22.35.4.73.52 1.13l1.7.3v2l-1.7.3c-.13.4-.3.78-.52 1.13l.86 1.5-1.4 1.4-1.5-.86c-.35.22-.73.4-1.13.52L9 15.2H7l-.3-1.7a4.8 4.8 0 0 1-1.13-.52l-1.5.86-1.4-1.4.86-1.5A4.8 4.8 0 0 1 3 9.3l-1.7-.3v-2l1.7-.3c.13-.4.3-.78.52-1.13l-.86-1.5 1.4-1.4 1.5.86c.35-.22.73-.4 1.13-.52L7 .8Z" />
  )

export const SplitIcon = ({ size = 16, className }: P): JSX.Element =>
  svg(
    size,
    className,
    <path d="M2 3a1 1 0 0 1 1-1h4v12H3a1 1 0 0 1-1-1V3Zm7-1h4a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9V2Z" />
  )

export const SingleIcon = ({ size = 16, className }: P): JSX.Element =>
  svg(size, className, <path d="M2 3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3Z" />)

export const PlusIcon = ({ size = 16, className }: P): JSX.Element =>
  svg(size, className, <path d="M7.2 2h1.6v5.2H14v1.6H8.8V14H7.2V8.8H2V7.2h5.2V2Z" />)

export const ChevronDownIcon = ({ size = 16, className }: P): JSX.Element =>
  svg(size, className, <path d="M3.5 6 8 10.5 12.5 6l-1-1L8 8.5 4.5 5l-1 1Z" />)

/** Counter-clockwise arrow around a clock — "recently closed / resume". */
export const HistoryIcon = ({ size = 16, className }: P): JSX.Element =>
  svg(
    size,
    className,
    <>
      <path d="M8 2.4a5.6 5.6 0 1 1-5.27 7.5l1.5-.54A4 4 0 1 0 8 4v1.9L5.2 3.7 8 1.5V2.4Z" />
      <path d="M7.25 5.5h1.3v2.9l2 1.18-.66 1.12-2.64-1.56V5.5Z" />
    </>
  )

export const XIcon = ({ size = 16, className }: P): JSX.Element =>
  svg(
    size,
    className,
    <path d="M4.3 3.3 8 7l3.7-3.7 1 1L10 8l3.7 3.7-1 1L8 9l-3.7 3.7-1-1L6 8 2.3 4.3l1-1Z" />
  )

export const ShellIcon = ({ size = 16, className }: P): JSX.Element =>
  svg(
    size,
    className,
    <path d="M2 3a1.5 1.5 0 0 1 1.5-1.5h9A1.5 1.5 0 0 1 14 3v10a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 13V3Zm2.7 2.3 2.1 2L4.7 9.4l.9.9 3-3-3-3-.9 1Zm3.6 4.5v1.2H11V9.8H8.3Z" />
  )

/** A four-point sparkle (Antigravity / Gemini-ish). */
export const SparkleIcon = ({ size = 16, className }: P): JSX.Element =>
  svg(size, className, <path d="M8 1.2 9.4 6 14 7.4 9.4 8.8 8 13.6 6.6 8.8 2 7.4 6.6 6 8 1.2Z" />)

/** A five-point star (Claude). */
export const StarIcon = ({ size = 16, className }: P): JSX.Element =>
  svg(
    size,
    className,
    <path d="M8 1.5 9.9 5.6l4.5.5-3.3 3 .9 4.4L8 11.3 4 13.5l.9-4.4-3.3-3 4.5-.5L8 1.5Z" />
  )

/** A solid hexagon (Codex). */
export const HexIcon = ({ size = 16, className }: P): JSX.Element =>
  svg(size, className, <path d="M8 1.3 13.8 4.6v6.8L8 14.7 2.2 11.4V4.6L8 1.3Z" />)

/** Generic agent (cpu/chip). */
export const AgentIcon = ({ size = 16, className }: P): JSX.Element =>
  svg(
    size,
    className,
    <path d="M6 1v1.5H5A2.5 2.5 0 0 0 2.5 5v6A2.5 2.5 0 0 0 5 13.5h6A2.5 2.5 0 0 0 13.5 11V5A2.5 2.5 0 0 0 11 2.5h-1V1H8.5v1.5h-1V1H6Zm-.5 4h5A1.5 1.5 0 0 1 12 6.5v3A1.5 1.5 0 0 1 10.5 11h-5A1.5 1.5 0 0 1 4 9.5v-3A1.5 1.5 0 0 1 5.5 5Z" />
  )

export const RepoIcon = ({ size = 14, className }: P): JSX.Element =>
  svg(
    size,
    className,
    <path d="M4.5 1.5A2.5 2.5 0 0 0 2 4v8.5A2.5 2.5 0 0 0 4.5 15H13a.75.75 0 0 0 .75-.75V2.25A.75.75 0 0 0 13 1.5H4.5Zm0 1.5h7.75v8.5H4.5a1 1 0 0 0-1 .73V4a1 1 0 0 1 1-1Zm.75 9.5h7v1h-7a.5.5 0 0 1 0-1Z" />
  )

/** Git merge: a branch dot feeding into the main line (finish worktree). */
export const MergeIcon = ({ size = 16, className }: P): JSX.Element =>
  svg(
    size,
    className,
    <path d="M5.45 5.15A4.25 4.25 0 0 0 9.25 7.5h1.38a2.25 2.25 0 1 1 0 1.5H9.25A5.73 5.73 0 0 1 5 7.12v3.51a2.25 2.25 0 1 1-1.5 0V5.37a2.25 2.25 0 1 1 1.95-.22ZM4.25 13.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm8.5-4.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm-8.5-5.25a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z" />
  )

/** Zoom / maximize a pane (two outward corner arrows). */
export const ZoomIcon = ({ size = 16, className }: P): JSX.Element =>
  svg(
    size,
    className,
    <path d="M2 2h5v1.6H4.73l3.04 3.04-1.13 1.13L3.6 4.73V7H2V2Zm12 12H9v-1.6h2.27L8.23 9.36l1.13-1.13 3.04 3.04V9H14v5Z" />
  )

/** A document/file (viewer panes). */
export const DocIcon = ({ size = 16, className }: P): JSX.Element =>
  svg(
    size,
    className,
    <path d="M4 1.5h5L13 5.5v8A1.5 1.5 0 0 1 11.5 15h-7A1.5 1.5 0 0 1 3 13.5v-10A2 2 0 0 1 4 1.5Zm4.5 1.2v3h3l-3-3ZM5.5 7.5h5v1.1h-5V7.5Zm0 2.4h5V11h-5V9.9Z" />
  )

/** A diff / code-review glyph (two rows with +/− implied). */
export const DiffIcon = ({ size = 16, className }: P): JSX.Element =>
  svg(
    size,
    className,
    <path d="M4 2h2v2h2v1.6H6v2H4v-2H2V4h2V2Zm-2 9h6v1.6H2V11Zm8-7.5 4 2.5-4 2.5V3.5Zm-1.5 8.1 1.1-1.1 1 1 2.4-2.4 1.1 1.1L11.6 14 8.5 11.6Z" />
  )

/** Tab icon for an agent, chosen by its configured icon char (presets) with a
 * generic fallback so custom agents still get a solid icon (never an emoji). */
export function AgentTabIcon({ icon, size = 13 }: { icon?: string; size?: number }): JSX.Element {
  if (icon === '❯') return <ShellIcon size={size} />
  if (icon === '★') return <StarIcon size={size} />
  if (icon === '◆') return <HexIcon size={size} />
  if (icon === '✦') return <SparkleIcon size={size} />
  if (icon === '▤') return <DocIcon size={size} />
  if (icon === '±') return <DiffIcon size={size} />
  return <AgentIcon size={size} />
}
