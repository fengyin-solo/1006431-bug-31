/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

/** 备件台账行：在通用 EntryRow 之上约定备件域字段，读写一律按备件编号取数。 */
export type SpareRow = EntryRow & {
  备件编号: string
  备件名称: string
  规格型号: string
  所属系统: string
  存放库位: string
  在库量: number
  最低储备量: number
  责任人员: string
  备件状态: string
  /** 行版本号：每次落库 +1，用来识别"读到的快照"与"已落库的版本"是不是同一份 */
  version: number
}

/** 出入库单据类型：领用、退库、入库、报废都会留流水。 */
export type SpareFlowType = '领用' | '退库' | '入库' | '报废'

/** 出入库流水：单号是幂等键，同一张单重复提交只落库一次。 */
export type SpareFlow = EntryRow & {
  单号: string
  单据类型: SpareFlowType
  备件编号: string
  备件名称: string
  数量: number
  经办人: string
  办理时间: string
  落库后在库量: number
  落库后库位: string
  备注: string
}

/** 补货台账：由备件状态判定结果同步生成，不手工维护。 */
export type ReplenishmentRow = EntryRow & {
  补货单号: string
  备件编号: string
  备件名称: string
  当前在库量: number
  最低储备量: number
  需补数量: number
  补货状态: string
  生成时间: string
  关闭时间: string
}
