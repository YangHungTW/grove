import { useSyncExternalStore } from 'react'
import { store } from './store'

/** Subscribe a component to the store's UI slice — layout, sessions, focus,
 * settings. This is the default; it deliberately does NOT re-render on the
 * sidebar-only meta slices (see the versions comment in store.ts). */
export function useStore(): typeof store {
  useSyncExternalStore(store.subscribe, store.getVersion)
  return store
}

/** Subscribe to EVERY slice — ui + worktree meta + fleet. Sidebar only: it is
 * the one part of the tree that renders git status lines, usage, PR badges and
 * the Elsewhere list, whose churn the rest of the app should never feel. */
export function useStoreAll(): typeof store {
  useSyncExternalStore(store.subscribe, store.getAllVersion)
  return store
}
