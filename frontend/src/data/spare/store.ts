import { buildSeedSpareDoc } from './seed'
import type { SpareDoc } from './types'

/**
 * 备件域持久化：备件、单据、补货台账三张表写在同一个 localStorage key 上，
 * 一次提交整份写入，要么全成要么不变，从存储层面保证「在库量与库位一起落库」。
 *
 * 读出去的一律是深拷贝，页面拿不到缓存里的原对象引用——根因里「只把内存里
 * 一份动了」的路径就此封死：除了 commitSpareDoc，谁也改不了这份记录。
 */
const STORAGE_KEY = 'waste-to-energy-plant:spare'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): SpareDoc {
  const fallback = buildSeedSpareDoc()
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Partial<SpareDoc>
    if (!Array.isArray(parsed.parts) || !Array.isArray(parsed.orders) || !Array.isArray(parsed.replenish)) {
      throw new Error('备件数据结构不完整')
    }
    return {
      parts: parsed.parts,
      orders: parsed.orders,
      replenish: parsed.replenish,
      seq: typeof parsed.seq === 'number' ? parsed.seq : parsed.parts.length,
    }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: SpareDoc | null = null

/** 取当前落库的备件数据（深拷贝），列表、详情、概览都从这一份读。 */
export function spareDoc(): SpareDoc {
  if (cache === null) {
    cache = readStorage()
  }
  return clone(cache)
}

/**
 * 原子落库：内存缓存与 localStorage 在同一步更新到同一版本。
 * 调用方必须基于上一次 spareDoc() 的结果整体改完再交进来，避免半改状态。
 */
export function commitSpareDoc(doc: SpareDoc): void {
  const snapshot = clone(doc)
  cache = clone(snapshot)
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
  }
}

export function resetSpareDoc(): SpareDoc {
  const doc = buildSeedSpareDoc()
  commitSpareDoc(doc)
  return spareDoc()
}

export function spareStorageKey(): string {
  return STORAGE_KEY
}
