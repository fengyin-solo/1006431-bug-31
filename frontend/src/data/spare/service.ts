import { deriveStatus, isBelowMinimum, reconcileReplenish } from './derive'
import { commitSpareDoc, resetSpareDoc, spareDoc } from './store'
import type {
  ReplenishEntry,
  SpareOrder,
  SpareOrderType,
  SparePart,
  SpareStats,
  SubmitOrderResult,
} from './types'

/** 业务校验未通过：不打断提交流程，只回传提示给页面。 */
class BusinessError extends Error {}

/**
 * 备件业务服务：所有备件改动的唯一入口。
 * 列表、详情、运营概览只读 store 里那一份；领用/退库/入库在这里一次性算完
 * （在库量 + 存放库位 + 状态 + 版本 + 补货台账），再原子提交落库。
 */

function nowText(): string {
  return new Date().toISOString().slice(0, 16).replace('T', ' ')
}

function matches(part: SparePart, filters: Record<string, string>): boolean {
  return Object.entries(filters).every(([field, value]) => {
    const keyword = value.trim()
    if (!keyword) return true
    const mapping: Record<string, string> = {
      备件编号: part.code,
      备件名称: part.name,
      规格型号: part.spec,
      所属系统: part.system,
    }
    return String(mapping[field] ?? '').includes(keyword)
  })
}

/** 备件列表：直接读已落库的那份，不经过任何内存副本。 */
export function listSpareParts(filters: Record<string, string> = {}): SparePart[] {
  return spareDoc()
    .parts.filter((part) => matches(part, filters))
    .sort((a, b) => a.id - b.id)
}

/** 按备件编号取数：列表、详情、单据、补货都以这个编号为唯一键。 */
export function getSparePart(code: string): SparePart | null {
  return spareDoc().parts.find((part) => part.code === code) ?? null
}

export function listSpareOrders(code?: string): SpareOrder[] {
  const orders = spareDoc().orders
  return orders
    .filter((order) => !code || order.code === code)
    .sort((a, b) => b.id - a.id)
}

export function listReplenishEntries(): ReplenishEntry[] {
  return spareDoc()
    .replenish.slice()
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === '预警中' ? -1 : 1
      return a.code.localeCompare(b.code, 'zh-Hans-CN')
    })
}

function openReplenish(entries: ReplenishEntry[]): number {
  return entries.filter((entry) => entry.status === '预警中').length
}

export function spareStats(): SpareStats {
  const doc = spareDoc()
  return {
    onHandCount: doc.parts.filter((part) => part.status === '在库可用').length,
    lowStockCount: openReplenish(doc.replenish),
    issuedCount: doc.parts.filter((part) => part.status === '已领用').length,
    pendingInboundCount: doc.parts.filter((part) => part.status === '待入库').length,
    scrappedCount: doc.parts.filter((part) => part.status === '已报废').length,
  }
}

function parseQty(raw: unknown): number {
  const qty = Math.floor(Number(raw))
  if (!Number.isFinite(qty) || qty <= 0) {
    return 0
  }
  return qty
}

type SubmitInput = {
  orderNo: string
  type: SpareOrderType
  code: string
  qty?: number
  /** 入库/退库要落到的库位；领用的库位由当前备件记录带出，不需要页面传 */
  location?: string
  /** 页面读到该备件时的版本号；不传表示不参与并发校验（种子迁移等内部场景） */
  expectedVersion?: number
}

/**
 * 提交领用/退库/入库/报废单。
 *
 * 幂等：同一张单号重复提交只生效一次，第二次直接返回首次结果，库存不再扣。
 * 并发：提交须携带读到的版本号；若该备件已被别人先落库（版本变了），本次作废，
 *       以先落库的那一版为准，调用方重新取数后再提交。
 */
export function submitSpareOrder(input: SubmitInput): SubmitOrderResult {
  const orderNo = input.orderNo.trim()
  if (!orderNo) {
    return { ok: false, message: '单号不能为空' }
  }
  const code = input.code.trim()
  if (!code) {
    return { ok: false, message: '备件编号不能为空' }
  }

  const doc = spareDoc()

  // 1) 幂等：单号是全局唯一键，先查单据再动备件。
  const existed = doc.orders.find((order) => order.orderNo === orderNo)
  if (existed) {
    const part = doc.parts.find((item) => item.code === existed.code)
    return {
      ok: true,
      duplicated: true,
      message: `单据 ${orderNo} 已提交过（${existed.type}），库存只扣减一次`,
      part: part ? { ...part } : undefined,
    }
  }

  // 2) 按备件编号取这一份记录——全链路唯一的取数方式。
  const index = doc.parts.findIndex((part) => part.code === code)
  if (index < 0) {
    return { ok: false, message: `备件台账中没有编号为 ${code} 的备件` }
  }
  const current = doc.parts[index]

  // 3) 乐观并发：版本对不上说明已被先落库，先落库那一版为准。
  if (typeof input.expectedVersion === 'number' && input.expectedVersion !== current.version) {
    return {
      ok: false,
      conflict: true,
      message: `备件 ${code} 的数据已被另一张单据先落库（版本 ${current.version}），请刷新后以当前数据为准重新办理`,
      part: { ...current },
    }
  }

  const now = nowText()
  let onHand = current.onHand
  let location = current.location
  let status = current.status
  let orderQty = 0

  const requireLocation = (): string => {
    const value = (input.location ?? '').trim()
    if (!value) {
      throw new BusinessError('入库必须指定存放库位')
    }
    return value
  }

  try {
    switch (input.type) {
      case '登记入库': {
        if (current.status === '已报废') {
          throw new BusinessError('已报废备件不能再入库')
        }
        const qty = parseQty(input.qty)
        if (!qty) throw new BusinessError('入库数量必须是正整数')
        location = requireLocation()
        onHand = current.onHand + qty
        orderQty = qty
        break
      }
      case '办理领用': {
        if (current.status === '待入库') {
          throw new BusinessError('备件尚未入库，不能领用')
        }
        if (current.status === '已报废') {
          throw new BusinessError('已报废备件不能领用')
        }
        if (current.onHand <= 0) {
          throw new BusinessError('备件在库量为 0，无件可领')
        }
        const qty = parseQty(input.qty)
        if (!qty) throw new BusinessError('领用数量必须是正整数')
        if (qty > current.onHand) {
          throw new BusinessError(`领用数量 ${qty} 超过在库量 ${current.onHand}`)
        }
        onHand = current.onHand - qty
        // 在库量与存放库位一起落库：领空则库位移出，没领完则库位保留，
        // 两者写在同一条备件记录的同一次提交里。
        if (onHand === 0) {
          location = ''
        }
        orderQty = qty
        break
      }
      case '办理退库': {
        if (current.status === '待入库') {
          throw new BusinessError('备件尚未办理过入库，不能退库')
        }
        if (current.status === '已报废') {
          throw new BusinessError('已报废备件不能退库')
        }
        const qty = parseQty(input.qty)
        if (!qty) throw new BusinessError('退库数量必须是正整数')
        location = requireLocation()
        onHand = current.onHand + qty
        orderQty = qty
        break
      }
      case '报废备件': {
        if (current.status === '已报废') {
          throw new BusinessError('备件已经报废，不用重复操作')
        }
        onHand = current.onHand
        location = current.location
        status = '已报废'
        orderQty = current.onHand
        break
      }
      default: {
        return { ok: false, message: `不支持的单据类型「${String(input.type)}」` }
      }
    }
  } catch (error) {
    if (error instanceof BusinessError) {
      return { ok: false, message: error.message, part: { ...current } }
    }
    throw error
  }

  // 报废是流程态；其余一律按在库量与最低储备量重新判定，判定结果就是备件状态。
  if (input.type !== '报废备件') {
    status = deriveStatus({ ...current, onHand, location })
  }

  const updated: SparePart = {
    ...current,
    onHand,
    location,
    status,
    version: current.version + 1,
    updatedAt: now,
  }

  const parts = doc.parts.slice()
  parts[index] = updated

  const order: SpareOrder = {
    id: doc.seq + 1,
    orderNo,
    type: input.type,
    code,
    qty: orderQty,
    location: input.type === '办理领用' ? current.location : location || undefined,
    baseVersion: current.version,
    finalVersion: updated.version,
    createdAt: now,
  }

  // 状态判定结果同步到补货台账：按备件编号 upsert，同一次提交内完成。
  const replenish = reconcileReplenish(parts, doc.replenish, now)

  // 一次性原子落库：备件、单据、补货台账与缓存同时更新到同一版本。
  commitSpareDoc({
    parts,
    orders: [...doc.orders, order],
    replenish,
    seq: order.id,
  })

  const verbMap: Record<SpareOrderType, string> = {
    登记入库: '入库',
    办理领用: '领用',
    办理退库: '退库',
    报废备件: '报废',
  }
  const lowHint = isBelowMinimum(updated) ? '，已低于最低储备量并同步到补货台账' : ''
  return {
    ok: true,
    message: `${verbMap[input.type]}已落库：${code} 在库量 ${current.onHand} → ${updated.onHand}，状态「${updated.status}」${lowHint}`,
    part: { ...updated },
  }
}

export function resetSpare(): void {
  resetSpareDoc()
}

export function exportSpareCsv(): { filename: string; content: string } {
  const header = ['备件编号', '备件名称', '规格型号', '所属系统', '存放库位', '在库量', '最低储备量', '责任人员', '备件状态', '版本号']
  const escape = (value: string | number) => {
    const text = String(value)
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  const lines = [header.join(',')]
  for (const part of listSpareParts()) {
    lines.push(
      [
        part.code,
        part.name,
        part.spec,
        part.system,
        part.location,
        part.onHand,
        part.minStock,
        part.owner,
        part.status,
        part.version,
      ]
        .map(escape)
        .join(','),
    )
  }
  return { filename: "备件台账-清单.csv", content: String.fromCharCode(0xFEFF) + lines.join(String.fromCharCode(10)) }
}