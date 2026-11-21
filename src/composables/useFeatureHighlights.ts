import { ref } from 'vue'
import type { NavItemConfig } from '@/config/navigation'

/**
 * "New" dots on HydraHop features. A dot shows on an item with `newIn` until
 * that page is opened once; the key includes the release, so a later release
 * can highlight the same page again. Stored per browser only.
 */
const PREFIX = 'hydrahop-seen:'
const seen = ref<Set<string>>(load())

function load(): Set<string> {
  try {
    const raw = localStorage.getItem(`${PREFIX}all`)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set()
  }
}

function keyOf(item: NavItemConfig): string | null {
  return item.newIn ? `${item.id}@${item.newIn}` : null
}

export function isNew(item: NavItemConfig): boolean {
  const key = keyOf(item)
  return key !== null && !seen.value.has(key)
}

/** True when the item, or any item below it, still shows a "new" dot. */
export function hasNew(item: NavItemConfig): boolean {
  return isNew(item) || (item.children ?? []).some(hasNew)
}

export function markSeen(item: NavItemConfig): void {
  const key = keyOf(item)
  if (key === null || seen.value.has(key)) return
  seen.value = new Set([...seen.value, key])
  try {
    localStorage.setItem(`${PREFIX}all`, JSON.stringify([...seen.value]))
  } catch {
    // Private windows and blocked storage: the dot simply comes back next visit.
  }
}
