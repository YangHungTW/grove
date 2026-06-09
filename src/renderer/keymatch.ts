/** Does a keydown event match an accelerator string like 'Ctrl+Shift+B'? */
export function matchesAccel(e: KeyboardEvent, accel: string): boolean {
  if (!accel) return false
  const need = { ctrl: false, shift: false, alt: false, meta: false }
  let key = ''
  for (const raw of accel.split('+')) {
    const p = raw.trim().toLowerCase()
    if (p === 'ctrl' || p === 'control') need.ctrl = true
    else if (p === 'shift') need.shift = true
    else if (p === 'alt' || p === 'option') need.alt = true
    else if (p === 'meta' || p === 'cmd' || p === 'command' || p === '⌘') need.meta = true
    else if (p) key = p
  }
  if (
    e.ctrlKey !== need.ctrl ||
    e.shiftKey !== need.shift ||
    e.altKey !== need.alt ||
    e.metaKey !== need.meta
  )
    return false
  const ek = e.key.toLowerCase()
  if (key === 'enter') return ek === 'enter'
  if (key === 'space') return ek === ' '
  return ek === key
}
