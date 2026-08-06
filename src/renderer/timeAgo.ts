/** Compact "x ago" label for a timestamp. Shared by the recently-closed agent
 * menu and the sidebar's Elsewhere list, which both need an age at a glance and
 * neither of which has room for a real date. */
export function timeAgo(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}
