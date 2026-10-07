import { listRows, transact } from '@/data/local-store'
import { filterRows } from '@/api/local-service'
import type { EntryRow, ReplenishmentRow, SpareFlow, SpareFlowType, SpareRow } from '@/data/types'

// 备件域的数据链路：台账(spare)、出入库流水(spare_flow)、补货台账(spare_replenishment)
// 三份数据在同一个事务里落库；页面、详情、运营概览全部从这里读同一份。
const SPARE_KEY = 'spare'
const FLOW_KEY = 'spare_flow'
const REPLENISH_KEY = 'spare_replenishment'

const SCRAPPED = '已报废'

export type FlowResult = {
  ok: boolean
  message: string
  /** 同一张单已落库过，本次按重复提交处理、没有重复扣减 */
  duplicated?: boolean
  /** 提交基于的版本与已落库版本不一致，已按先落库的版本重算 */
  rebased?: boolean
  spare?: SpareRow
}

function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function text(value: unknown): string {
  return String(value ?? '')
}

function asSpare(row: EntryRow): SpareRow {
  return row as SpareRow
}

/** 事务回调的返回形状：新的整体状态 + 带给调用方的结果。 */
type Tx<T> = { state: Record<string, EntryRow[]>; result: T }

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, num(row.id)), 0) + 1
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function formatNow(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 备件状态判定：全部由在库量、最低储备量与流转状态推导，任何地方不手工填写。 */
function judgeSpare(row: EntryRow): { 备件状态: string; status: string; abnormal: boolean } {
  if (row.status === SCRAPPED) {
    return { 备件状态: '已报废', status: '已报废', abnormal: false }
  }
  const qty = num(row.在库量)
  const min = num(row.最低储备量)
  if (qty <= 0) {
    return row.status === '待入库'
      ? { 备件状态: '待入库', status: '待入库', abnormal: qty < min }
      : { 备件状态: '已领空', status: '已领用', abnormal: qty < min }
  }
  if (qty < min) {
    return { 备件状态: '低于储备', status: '在库可用', abnormal: true }
  }
  return { 备件状态: '在库可用', status: '在库可用', abnormal: false }
}

/**
 * 把备件状态判定结果同步到补货台账：低于最低储备量的备件挂一张待补货单，
 * 补足或报废后把对应的待补货单关掉。只在事务里调用，与台账同一次落库。
 */
function syncReplenishments(spares: EntryRow[], replenishments: EntryRow[], now: string): EntryRow[] {
  const next = replenishments.map((row) => ({ ...row }))
  const openByCode = new Map<string, EntryRow>()
  for (const row of next) {
    if (row.补货状态 === '待补货') {
      openByCode.set(text(row.备件编号), row)
    }
  }
  for (const spare of spares) {
    const code = text(spare.备件编号)
    const qty = num(spare.在库量)
    const min = num(spare.最低储备量)
    const need = min - qty
    const open = openByCode.get(code)
    if (spare.status !== SCRAPPED && need > 0) {
      if (open) {
        open.备件名称 = text(spare.备件名称)
        open.当前在库量 = qty
        open.最低储备量 = min
        open.需补数量 = need
      } else {
        next.push({
          id: nextId(next),
          status: '待补货',
          pending: true,
          abnormal: false,
          补货单号: `BH-${code}`,
          备件编号: code,
          备件名称: text(spare.备件名称),
          当前在库量: qty,
          最低储备量: min,
          需补数量: need,
          补货状态: '待补货',
          生成时间: now,
          关闭时间: '',
        })
      }
    } else if (open) {
      open.补货状态 = spare.status === SCRAPPED ? '已关闭' : '已补足'
      open.status = open.补货状态
      open.pending = false
      open.当前在库量 = qty
      open.需补数量 = Math.max(need, 0)
      open.关闭时间 = now
      openByCode.delete(code)
    }
  }
  return next
}

// ---------- 读：列表、详情、概览都读这同一份 ----------

export function listSpares(filters: Record<string, string> = {}): SpareRow[] {
  return filterRows(listRows(SPARE_KEY), filters).map(asSpare)
}

/** 按备件编号取数：详情页与列表读的是同一条记录。 */
export function getSpareByCode(code: string): SpareRow | null {
  const row = listRows(SPARE_KEY).find((item) => text(item.备件编号) === code)
  return row ? asSpare(row) : null
}

export function listFlows(code?: string): SpareFlow[] {
  const rows = listRows(FLOW_KEY)
  const matched = code ? rows.filter((row) => text(row.备件编号) === code) : rows
  return matched.map((row) => row as SpareFlow)
}

export function listReplenishments(): ReplenishmentRow[] {
  return listRows(REPLENISH_KEY).map((row) => row as ReplenishmentRow)
}

export function spareStats(): { label: string; value: number }[] {
  const spares = listSpares()
  const count = (status: string) => spares.filter((row) => row.备件状态 === status).length
  const openReplenishments = listReplenishments().filter((row) => row.补货状态 === '待补货').length
  return [
    { label: '在库可用备件', value: count('在库可用') },
    { label: '低于储备备件', value: count('低于储备') },
    { label: '已领空备件', value: count('已领空') },
    { label: '待补货单', value: openReplenishments },
  ]
}

// ---------- 写：全部走事务，领用/退库/入库共用一条链路 ----------

export type FlowInput = {
  单号: string
  单据类型: '领用' | '退库' | '入库'
  备件编号: string
  数量: number
  经办人: string
  /** 退库/入库时的目标库位；缺省沿用台账里的库位 */
  库位?: string
  /** 提交方读到的行版本号，用于识别"同时发生"的改动 */
  expectedVersion?: number
  备注?: string
}

export function submitSpareFlow(input: FlowInput): FlowResult {
  const billNo = input.单号.trim()
  const code = input.备件编号.trim()
  const qty = Math.trunc(num(input.数量))
  if (!billNo) {
    return { ok: false, message: '单据编号不能为空' }
  }
  if (!code) {
    return { ok: false, message: '备件编号不能为空' }
  }
  if (qty <= 0) {
    return { ok: false, message: '数量必须大于 0' }
  }

  return transact((state): Tx<FlowResult> => {
    const spares = [...(state[SPARE_KEY] ?? [])]
    const flows = [...(state[FLOW_KEY] ?? [])]
    const replenishments = [...(state[REPLENISH_KEY] ?? [])]
    const now = formatNow()

    // 幂等：同一张单已落库过，直接返回已落库的结果，不再重复扣减。
    const existing = flows.find((flow) => text(flow.单号) === billNo)
    if (existing) {
      const sameBill =
        text(existing.备件编号) === code &&
        text(existing.单据类型) === input.单据类型 &&
        num(existing.数量) === qty
      if (!sameBill) {
        return { state, result: { ok: false, message: `单号 ${billNo} 已被其他单据占用，请更换单号` } }
      }
      const spare = spares.find((row) => text(row.备件编号) === code)
      return {
        state,
        result: {
          ok: true,
          duplicated: true,
          spare: spare ? asSpare(spare) : undefined,
          message: `${input.单据类型}单 ${billNo} 已落库，重复提交不再${input.单据类型 === '领用' ? '扣减' : '变动'}库存`,
        },
      }
    }

    const index = spares.findIndex((row) => text(row.备件编号) === code)
    if (index < 0) {
      return { state, result: { ok: false, message: `没有找到备件编号为 ${code} 的备件` } }
    }
    const current = spares[index]
    if (current.status === SCRAPPED) {
      return { state, result: { ok: false, message: `备件 ${code} 已报废，不能办理出入库` } }
    }

    // 并发：提交基于的版本与已落库版本不一致时，以先落库的那一版为准，
    // 在这版上重新校验并套用本次增减，绝不用旧快照整体覆盖。
    const rebased =
      input.expectedVersion !== undefined && num(current.version) !== input.expectedVersion

    const before = num(current.在库量)
    let after = before
    let location = text(current.存放库位)
    if (input.单据类型 === '领用') {
      if (before < qty) {
        return {
          state,
          result: { ok: false, rebased, message: `备件 ${code} 当前在库量 ${before}，不足领用 ${qty} 件` },
        }
      }
      after = before - qty
      if (after === 0) {
        // 领空后库位随在库量一起落库，两处不会再对不上
        location = ''
      }
    } else {
      after = before + qty
      location = (input.库位 ?? '').trim() || location
      if (!location) {
        return { state, result: { ok: false, message: `${input.单据类型}需要指定存放库位` } }
      }
    }

    const judged = judgeSpare({ ...current, 在库量: after })
    const updated: EntryRow = {
      ...current,
      在库量: after,
      存放库位: location,
      备件状态: judged.备件状态,
      status: judged.status,
      abnormal: judged.abnormal,
      pending: judged.status !== SCRAPPED,
      version: num(current.version) + 1,
    }
    spares[index] = updated

    flows.push({
      id: nextId(flows),
      status: '已落库',
      pending: false,
      abnormal: false,
      单号: billNo,
      单据类型: input.单据类型,
      备件编号: code,
      备件名称: text(current.备件名称),
      数量: qty,
      经办人: input.经办人.trim() || '值班管理员',
      办理时间: now,
      落库后在库量: after,
      落库后库位: location || '—',
      备注: (input.备注 ?? '').trim(),
    })

    const nextState = {
      ...state,
      [SPARE_KEY]: spares,
      [FLOW_KEY]: flows,
      [REPLENISH_KEY]: syncReplenishments(spares, replenishments, now),
    }
    return {
      state: nextState,
      result: {
        ok: true,
        rebased,
        spare: asSpare(updated),
        message: `${input.单据类型}单 ${billNo} 已落库：${code} 在库量 ${before} → ${after}${
          rebased ? '（期间有其他出入库先落库，已按最新在库量办理）' : ''
        }`,
      },
    }
  })
}

export function submitRequisition(input: Omit<FlowInput, '单据类型'>): FlowResult {
  return submitSpareFlow({ ...input, 单据类型: '领用' })
}

export function submitReturn(input: Omit<FlowInput, '单据类型'>): FlowResult {
  return submitSpareFlow({ ...input, 单据类型: '退库' })
}

export function submitInbound(input: Omit<FlowInput, '单据类型'>): FlowResult {
  return submitSpareFlow({ ...input, 单据类型: '入库' })
}

/** 报废备件：在库量清零、库位腾空、状态置为已报废，与补货台账同一次落库。 */
export function scrapSpare(code: string, operator: string, expectedVersion?: number): FlowResult {
  const trimmed = code.trim()
  if (!trimmed) {
    return { ok: false, message: '备件编号不能为空' }
  }
  return transact((state): Tx<FlowResult> => {
    const spares = [...(state[SPARE_KEY] ?? [])]
    const flows = [...(state[FLOW_KEY] ?? [])]
    const replenishments = [...(state[REPLENISH_KEY] ?? [])]
    const now = formatNow()
    const index = spares.findIndex((row) => text(row.备件编号) === trimmed)
    if (index < 0) {
      return { state, result: { ok: false, message: `没有找到备件编号为 ${trimmed} 的备件` } }
    }
    const current = spares[index]
    if (current.status === SCRAPPED) {
      return { state, result: { ok: false, message: `备件 ${trimmed} 已经是已报废，不用重复操作` } }
    }
    const rebased = expectedVersion !== undefined && num(current.version) !== expectedVersion
    const before = num(current.在库量)
    const updated: EntryRow = {
      ...current,
      在库量: 0,
      存放库位: '',
      备件状态: '已报废',
      status: '已报废',
      abnormal: false,
      pending: false,
      version: num(current.version) + 1,
    }
    spares[index] = updated
    flows.push({
      id: nextId(flows),
      status: '已落库',
      pending: false,
      abnormal: false,
      单号: `BF-${now.replace(/[-: ]/g, '')}-${trimmed}`,
      单据类型: '报废',
      备件编号: trimmed,
      备件名称: text(current.备件名称),
      数量: before,
      经办人: operator.trim() || '值班管理员',
      办理时间: now,
      落库后在库量: 0,
      落库后库位: '—',
      备注: '报废出库',
    })
    const nextState = {
      ...state,
      [SPARE_KEY]: spares,
      [FLOW_KEY]: flows,
      [REPLENISH_KEY]: syncReplenishments(spares, replenishments, now),
    }
    return {
      state: nextState,
      result: {
        ok: true,
        rebased,
        spare: asSpare(updated),
        message: `备件 ${trimmed} 已报废，在库量 ${before} → 0`,
      },
    }
  })
}

/** 登记备品备件：编号唯一，初始待入库、在库量 0，状态判定与补货台账同步落库。 */
export function registerSpare(input: {
  备件编号: string
  备件名称: string
  规格型号: string
  所属系统: string
  最低储备量: number
  责任人员: string
}): FlowResult {
  const code = input.备件编号.trim()
  if (!code) {
    return { ok: false, message: '备件编号不能为空' }
  }
  if (!input.备件名称.trim()) {
    return { ok: false, message: '备件名称不能为空' }
  }
  return transact((state): Tx<FlowResult> => {
    const spares = [...(state[SPARE_KEY] ?? [])]
    const replenishments = [...(state[REPLENISH_KEY] ?? [])]
    if (spares.some((row) => text(row.备件编号) === code)) {
      return { state, result: { ok: false, message: `备件编号 ${code} 已存在，不能重复登记` } }
    }
    const now = formatNow()
    const row: EntryRow = {
      id: nextId(spares),
      status: '待入库',
      pending: true,
      abnormal: false,
      version: 1,
      备件编号: code,
      备件名称: input.备件名称.trim(),
      规格型号: input.规格型号.trim(),
      所属系统: input.所属系统.trim(),
      存放库位: '',
      在库量: 0,
      最低储备量: Math.max(0, Math.trunc(num(input.最低储备量))),
      责任人员: input.责任人员.trim(),
      备件状态: '待入库',
    }
    const judged = judgeSpare(row)
    row.备件状态 = judged.备件状态
    row.status = judged.status
    row.abnormal = judged.abnormal
    spares.push(row)
    const nextState = {
      ...state,
      [SPARE_KEY]: spares,
      [REPLENISH_KEY]: syncReplenishments(spares, replenishments, now),
    }
    return {
      state: nextState,
      result: { ok: true, spare: asSpare(row), message: `备件 ${code} 已登记，当前状态「待入库」` },
    }
  })
}

/** 生成建议单号：同一备件同一秒重复提交会得到同一个单号，配合幂等只落库一次。 */
export function suggestFlowNo(type: SpareFlowType, code: string): string {
  const prefix = { 领用: 'LY', 退库: 'TK', 入库: 'RK', 报废: 'BF' }[type]
  const d = new Date()
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  return `${prefix}-${stamp}-${code}`
}
