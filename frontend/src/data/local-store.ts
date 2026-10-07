import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'waste-to-energy-plant:entries'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function persist(state: Record<string, EntryRow[]>): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }
}

// 旧版本地数据里的备件行没有数量字段（在库量/version），结构对不上时
// 用种子里的备件台账、流水与补货台账整体替换，避免读出 undefined。
function needsSpareMigration(rows: EntryRow[] | undefined): boolean {
  if (!rows) {
    return false
  }
  return rows.some((row) => typeof row['在库量'] !== 'number' || typeof row['version'] !== 'number')
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    persist(fallback)
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    const merged = { ...fallback, ...parsed }
    if (needsSpareMigration(merged.spare)) {
      merged.spare = clone(SEED_ROWS.spare ?? [])
      merged.spare_flow = clone(SEED_ROWS.spare_flow ?? [])
      merged.spare_replenishment = clone(SEED_ROWS.spare_replenishment ?? [])
      persist(merged)
    }
    return merged
  } catch {
    persist(fallback)
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  // 基于已落库的最新状态合并，避免用内存里的旧快照覆盖掉别的页签刚写入的其他模块。
  const next = { ...readStorage(), [key]: rows }
  cache = next
  persist(next)
}

/**
 * 事务式修改：写之前先重读 localStorage 里已落库的最新状态，在它的基础上
 * 应用变更再整体写回。同一条数据被多处同时改动时，先落库的版本不会被旧快照
 * 覆盖——以先落库的为准。变更与读取在同一次同步调用里完成，中途不会被打断。
 */
export function transact<T>(
  mutator: (state: Record<string, EntryRow[]>) => { state: Record<string, EntryRow[]>; result: T },
): T {
  const fresh = readStorage()
  const { state, result } = mutator(fresh)
  cache = state
  persist(state)
  return result
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
