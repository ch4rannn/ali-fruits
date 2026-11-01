import { useSyncExternalStore } from 'react'

/** A tiny persisted store, so the cart and chosen area survive reloads without a state library. */
export function createStore<T>(key: string, initial: T) {
  let state = initial
  try {
    const saved = localStorage.getItem(key)
    if (saved) state = { ...initial, ...JSON.parse(saved) }
  } catch {
    state = initial
  }
  const listeners = new Set<() => void>()
  const persist = () => {
    try {
      localStorage.setItem(key, JSON.stringify(state))
    } catch {
      // Private browsing can refuse storage. The page still works for this visit.
    }
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (event) => {
      if (event.key !== key || !event.newValue) return
      try {
        state = { ...initial, ...JSON.parse(event.newValue) }
        listeners.forEach((listener) => listener())
      } catch {
        // Ignore a damaged value from another tab.
      }
    })
  }
  return {
    get: () => state,
    set(next: T | ((current: T) => T)) {
      state = typeof next === 'function' ? (next as (current: T) => T)(state) : next
      persist()
      listeners.forEach((listener) => listener())
    },
    use: () => useSyncExternalStore((listener) => (listeners.add(listener), () => listeners.delete(listener)), () => state),
  }
}
