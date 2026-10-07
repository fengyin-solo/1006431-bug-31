/**
 * 备件专属数据域的类型。
 *
 * 备件按「备件编号」唯一取数：在库量与存放库位同属一条备件记录，任何领用、退库、
 * 入库都一次性原子落库到这条记录上，列表、详情、运营概览读的都是同一份。
 */

/** 备件状态：待入库 / 在库可用 / 待补货 / 已领用 / 已报废 */
export type SpareStatus = '待入库' | '在库可用' | '待补货' | '已领用' | '已报废'

/** 单据种类：入库、领用、退库、报废共用一张单据表，用单号做幂等键。 */
export type SpareOrderType = '登记入库' | '办理领用' | '办理退库' | '报废备件'

/** 补货台账条目状态：预警中表示需要补货，已补货表示之前的预警已解除（留档）。 */
export type ReplenishStatus = '预警中' | '已补货'

export type SparePart = {
  /** 行内主键，自增 */
  id: number
  /** 备件编号：业务唯一键，一切取数、补货关联、单据关联都按它走 */
  code: string
  name: string
  spec: string
  system: string
  /** 存放库位：与在库量同一条记录、同一次落库；在库量为 0 时为空串 */
  location: string
  /** 最低储备量 */
  minStock: number
  /** 在库量：与存放库位共存在同一份记录上，不存在第二份副本 */
  onHand: number
  owner: string
  /** 备件状态，由在库量与最低储备量判定，每次落库后同步 */
  status: SpareStatus
  /** 乐观并发版本：每次成功落库 +1，提交时必须带上读到的版本，先落库者为准 */
  version: number
  updatedAt: string
}

export type SpareOrder = {
  id: number
  /** 领用/退库/入库单号：同一张单号重复提交只生效一次 */
  orderNo: string
  type: SpareOrderType
  /** 提交时针对的备件编号 */
  code: string
  /** 本次变动数量（报废单记录报废时的在库量） */
  qty: number
  /** 退库/入库要落到的库位 */
  location?: string
  /** 本次落库前备件版本：用于并发冲突判定 */
  baseVersion: number
  /** 本次落库后备件版本 */
  finalVersion: number
  createdAt: string
}

export type ReplenishEntry = {
  id: number
  /** 按备件编号关联，一条备件最多一条台账条目，反复预警在原条目上更新 */
  code: string
  name: string
  minStock: number
  /** 最近一次同步时的在库量快照 */
  onHand: number
  /** 备件状态判定结果同步过来：待补货 / 已领用 等 */
  partStatus: SpareStatus
  status: ReplenishStatus
  openedAt: string
  /** 最近一次预警同步时间（一直预警也会刷新） */
  updatedAt: string
  /** 解除预警时间 */
  resolvedAt?: string
}

/** 备件域整体落库结构：三张表写在同一个 localStorage key 里，一次提交原子生效。 */
export type SpareDoc = {
  parts: SparePart[]
  orders: SpareOrder[]
  replenish: ReplenishEntry[]
  seq: number
}

export type SpareStats = {
  onHandCount: number
  lowStockCount: number
  issuedCount: number
  pendingInboundCount: number
  scrappedCount: number
}

export type SubmitOrderResult = {
  ok: boolean
  message: string
  /** 命中幂等：单号已存在，本次未再扣减库存 */
  duplicated?: boolean
  /** 并发冲突：读到的版本已过期，先落库的那一版为准 */
  conflict?: boolean
  part?: SparePart
}
