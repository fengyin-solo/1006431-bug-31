import { reconcileReplenish } from './derive'
import type { SpareDoc, SparePart } from './types'

// 备件示例数据：在库量与存放库位是同一条记录上的两个字段，不再分开放。
// 首次进入备件模块时播种；之后一切领用/退库/入库都在这份上原子落库。
const SEED_PARTS: SparePart[] = [
  {
    id: 1,
    code: 'SPAR-0001',
    name: '液压给料推杆密封圈',
    spec: 'DN120 耐油橡胶',
    system: '给料系统',
    location: '',
    minStock: 4,
    onHand: 0,
    owner: '王建国',
    status: '待入库',
    version: 1,
    updatedAt: '2026-10-07 08:30',
  },
  {
    id: 2,
    code: 'SPAR-0002',
    name: '焚烧炉热电偶',
    spec: 'K型 0-1200℃ 法兰式',
    system: '焚烧系统',
    location: 'A库-03-02',
    minStock: 6,
    onHand: 12,
    owner: '李秀兰',
    status: '在库可用',
    version: 1,
    updatedAt: '2026-10-07 08:30',
  },
  {
    id: 3,
    code: 'SPAR-0003',
    name: '引风机轴承',
    spec: 'SKF 6316/C3',
    system: '烟气系统',
    location: 'A库-05-01',
    minStock: 8,
    onHand: 3,
    owner: '张志强',
    status: '待补货',
    version: 1,
    updatedAt: '2026-10-07 08:30',
  },
  {
    id: 4,
    code: 'SPAR-0004',
    name: '机械密封组件',
    spec: 'M74N-60 合金对合金',
    system: '汽机系统',
    location: 'B库-02-04',
    minStock: 2,
    onHand: 5,
    owner: '陈晓敏',
    status: '在库可用',
    version: 1,
    updatedAt: '2026-10-07 08:30',
  },
  {
    id: 5,
    code: 'SPAR-0005',
    name: '活性炭输送螺杆',
    spec: 'φ80 L1800 304不锈钢',
    system: '烟气净化系统',
    location: '',
    minStock: 3,
    onHand: 0,
    owner: '赵海东',
    status: '已领用',
    version: 1,
    updatedAt: '2026-10-07 08:30',
  },
]

export function buildSeedSpareDoc(): SpareDoc {
  const parts = SEED_PARTS.map((part) => ({ ...part }))
  // 初始补货台账也按同一套判定同步出来，保证种子数据本身就一致。
  const replenish = reconcileReplenish(parts, [])
  return {
    parts,
    orders: [],
    replenish,
    seq: parts.length,
  }
}
