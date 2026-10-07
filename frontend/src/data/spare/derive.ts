import type { ReplenishEntry, SparePart, SpareStatus } from './types'

/**
 * 备件域的纯判定逻辑：不碰存储、不碰缓存，任何入口（种子、领用、退库、入库）
 * 都走同一套判定，保证列表、详情、概览、补货台账看到的是同一个结论。
 */

/** 是否低于最低储备量：在库（待入库、已报废不参与预警）且数量低于最低储备量。 */
export function isBelowMinimum(part: SparePart): boolean {
  if (part.status === '待入库' || part.status === '已报废') {
    return false
  }
  return part.onHand < part.minStock
}

/**
 * 由在库量判定备件状态。
 * - 待入库 / 已报废 是流程态，不由数量推导，原样保留；
 * - 在库量为 0 且之前已在库 → 已领用（领空）；
 * - 在库但低于最低储备量 → 待补货；
 * - 其余 → 在库可用。
 */
export function deriveStatus(part: SparePart): SpareStatus {
  if (part.status === '待入库' || part.status === '已报废') {
    return part.status
  }
  if (part.onHand <= 0) {
    return '已领用'
  }
  if (part.onHand < part.minStock) {
    return '待补货'
  }
  return '在库可用'
}

function nowText(): string {
  return new Date().toISOString().slice(0, 16).replace('T', ' ')
}

/**
 * 把备件状态判定结果同步到补货台账（按备件编号 upsert，一条备件一条）：
 * - 低于最低储备量：存在则复用并刷新预警，不存在则新开一条；
 * - 回到最低储备量以上：把之前的预警置为「已补货」并留档；
 * - 待入库 / 已报废 不产生补货条目，也不关闭既有条目（报废由调用方决定）。
 */
export function reconcileReplenish(
  parts: SparePart[],
  prev: ReplenishEntry[],
  now: string = nowText(),
): ReplenishEntry[] {
  const entries = prev.map((entry) => ({ ...entry }))
  const byCode = new Map(entries.map((entry) => [entry.code, entry]))

  for (const part of parts) {
    const low = isBelowMinimum(part)
    const existing = byCode.get(part.code)
    if (low) {
      if (existing) {
        existing.onHand = part.onHand
        existing.minStock = part.minStock
        existing.name = part.name
        existing.partStatus = part.status
        existing.updatedAt = now
        if (existing.status === '已补货') {
          existing.status = '预警中'
          existing.resolvedAt = undefined
        }
      } else {
        const entry: ReplenishEntry = {
          id: 0,
          code: part.code,
          name: part.name,
          minStock: part.minStock,
          onHand: part.onHand,
          partStatus: part.status,
          status: '预警中',
          openedAt: now,
          updatedAt: now,
        }
        entries.push(entry)
        byCode.set(entry.code, entry)
      }
    } else if (existing && existing.status === '预警中') {
      existing.onHand = part.onHand
      existing.minStock = part.minStock
      existing.name = part.name
      existing.partStatus = part.status
      existing.status = '已补货'
      existing.updatedAt = now
      existing.resolvedAt = now
    }
  }

  let nextId = entries.reduce((max, entry) => Math.max(max, entry.id), 0)
  for (const entry of entries) {
    if (entry.id === 0) {
      nextId += 1
      entry.id = nextId
    }
  }
  return entries
}
