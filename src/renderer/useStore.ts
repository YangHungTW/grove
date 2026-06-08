import { useSyncExternalStore } from 'react'
import { store } from './store'

/** Subscribe a component to the store; re-renders on any store change. */
export function useStore(): typeof store {
  useSyncExternalStore(store.subscribe, store.getVersion)
  return store
}
