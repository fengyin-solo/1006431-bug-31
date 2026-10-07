// 备件数据链路回归测试：领用落库、同源读取、幂等、并发以先落库为准、补货台账同步。
// 运行：npm test（由 scripts/run-tests.mjs 用 esbuild 打包后在 node 里执行）

// 先装好 localStorage，再动态引入被测模块（模块加载时就会读存储）
const storage = new Map<string, string>()
;(globalThis as Record<string, unknown>).window = {
  localStorage: {
    getItem: (key: string) => (storage.has(key) ? storage.get(key)! : null),
    setItem: (key: string, value: string) => void storage.set(key, String(value)),
    removeItem: (key: string) => void storage.delete(key),
  },
}

const service = await import('@/api/spare-service')
const { storageKey } = await import('@/data/local-store')
const { loadOverview } = await import('@/api/local-service')

type AnyRow = Record<string, string | number | boolean>

let passed = 0
let failed = 0

function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    passed += 1
    console.log(`  ✓ ${name}`)
  } else {
    failed += 1
    console.error(`  ✗ ${name}`, extra === undefined ? '' : extra)
  }
}

function persisted(): Record<string, AnyRow[]> {
  return JSON.parse(storage.get(storageKey())!) as Record<string, AnyRow[]>
}

function persistedSpare(code: string): AnyRow {
  return persisted().spare.find((row) => row['备件编号'] === code)!
}

console.log('备件数据链路回归测试')

// 1. 初始数据：种子播种，低于最低储备量的备件已标出并同步补货台账
const initial = service.listSpares()
check('初始台账 3 条', initial.length === 3, initial.length)
const s2 = service.getSpareByCode('SPAR-0002')!
check('SPAR-0002 判定为低于储备并标出', s2.备件状态 === '低于储备' && s2.abnormal === true)
check(
  '补货台账已有 SPAR-0002 待补货 2 件',
  service
    .listReplenishments()
    .some((row) => row.备件编号 === 'SPAR-0002' && row.补货状态 === '待补货' && Number(row.需补数量) === 2),
)

// 2. 办理领用：在库量与库位一起落库，列表/详情/存储读到的同一份
const r1 = service.submitRequisition({
  单号: 'LY-TEST-001',
  备件编号: 'SPAR-0001',
  数量: 4,
  经办人: '测试员',
  expectedVersion: 1,
})
check('领用落库成功', r1.ok, r1.message)
check('领用后在库量 24 → 20', service.getSpareByCode('SPAR-0001')!.在库量 === 20)
check('库位保持 A区-01-03', service.getSpareByCode('SPAR-0001')!.存放库位 === 'A区-01-03')
check('行版本号 +1', service.getSpareByCode('SPAR-0001')!.version === 2)
check(
  '列表与详情读到同一份',
  service.listSpares().find((row) => row.备件编号 === 'SPAR-0001')!.在库量 ===
    service.getSpareByCode('SPAR-0001')!.在库量,
)
check('已落库（刷新后还是扣过的数）', persistedSpare('SPAR-0001')['在库量'] === 20)

// 3. 幂等：同一张领用单重复提交只扣一次
const r2 = service.submitRequisition({
  单号: 'LY-TEST-001',
  备件编号: 'SPAR-0001',
  数量: 4,
  经办人: '测试员',
  expectedVersion: 2,
})
check('重复提交返回已落库', r2.ok && r2.duplicated === true, r2.message)
check('重复提交不再扣减', service.getSpareByCode('SPAR-0001')!.在库量 === 20)
check('同一单号流水只有一条', service.listFlows().filter((flow) => flow.单号 === 'LY-TEST-001').length === 1)
const r2b = service.submitRequisition({ 单号: 'LY-TEST-001', 备件编号: 'SPAR-0002', 数量: 1, 经办人: '测试员' })
check('同单号不同内容被拒绝', !r2b.ok, r2b.message)

// 4. 登记入库：待入库 → 在库可用，补货台账同步关闭
const r3 = service.submitInbound({
  单号: 'RK-TEST-001',
  备件编号: 'SPAR-0003',
  数量: 30,
  经办人: '测试员',
  库位: 'B区-05-01',
  expectedVersion: 1,
})
check('入库落库成功', r3.ok, r3.message)
const s3 = service.getSpareByCode('SPAR-0003')!
check('入库后在库量与库位一起落库', s3.在库量 === 30 && s3.存放库位 === 'B区-05-01')
check('状态判定为在库可用', s3.备件状态 === '在库可用' && s3.abnormal === false)
check(
  '补货台账同步为已补足',
  service.listReplenishments().find((row) => row.备件编号 === 'SPAR-0003')!.补货状态 === '已补足',
)

// 5. 领空：在库量归零的同时库位一起落库
const r4 = service.submitRequisition({
  单号: 'LY-TEST-002',
  备件编号: 'SPAR-0001',
  数量: 20,
  经办人: '测试员',
  expectedVersion: 2,
})
check('领空落库成功', r4.ok, r4.message)
const s1 = service.getSpareByCode('SPAR-0001')!
check('在库量 0 且库位腾空（同一条记录一起落库）', s1.在库量 === 0 && s1.存放库位 === '')
check('判定为已领空', s1.备件状态 === '已领空' && s1.status === '已领用')
check('领空后仍按低于储备标出', s1.abnormal === true)
const repl1 = service.listReplenishments().find((row) => row.备件编号 === 'SPAR-0001')!
check('补货台账新增 SPAR-0001 待补货 10 件', repl1.补货状态 === '待补货' && Number(repl1.需补数量) === 10)

// 6. 超领拒绝：库存不足不能扣成负数
const r5 = service.submitRequisition({ 单号: 'LY-TEST-003', 备件编号: 'SPAR-0001', 数量: 1, 经办人: '测试员' })
check('库存不足拒绝领用', !r5.ok, r5.message)
check('拒绝后在库量不变', service.getSpareByCode('SPAR-0001')!.在库量 === 0)

// 7. 退库：数量与库位一起落库，补货台账跟着重算
const r6 = service.submitReturn({
  单号: 'TK-TEST-001',
  备件编号: 'SPAR-0001',
  数量: 5,
  经办人: '测试员',
  库位: 'A区-01-03',
  expectedVersion: 3,
})
check('退库落库成功', r6.ok, r6.message)
const s1b = service.getSpareByCode('SPAR-0001')!
check('退库后在库量 5、库位恢复', s1b.在库量 === 5 && s1b.存放库位 === 'A区-01-03')
check('判定为低于储备', s1b.备件状态 === '低于储备')
const repl1b = service.listReplenishments().find((row) => row.备件编号 === 'SPAR-0001')!
check('补货单需补数量同步为 5', repl1b.补货状态 === '待补货' && Number(repl1b.需补数量) === 5)

// 8. 并发：领用与退库基于同一旧版本同时提交，以先落库的那一版为准
const staleVersion = service.getSpareByCode('SPAR-0001')!.version
const rA = service.submitReturn({
  单号: 'TK-TEST-002',
  备件编号: 'SPAR-0001',
  数量: 5,
  经办人: '甲',
  库位: 'A区-01-03',
  expectedVersion: staleVersion,
})
check('退库先落库', rA.ok && rA.rebased !== true, rA.message)
const rB = service.submitRequisition({
  单号: 'LY-TEST-004',
  备件编号: 'SPAR-0001',
  数量: 2,
  经办人: '乙',
  expectedVersion: staleVersion,
})
check('后到的领用按先落库的版本重算并提示', rB.ok && rB.rebased === true, rB.message)
check(
  '最终在库量 = 5 + 5 - 2 = 8（不是旧快照算出的 3）',
  service.getSpareByCode('SPAR-0001')!.在库量 === 8,
  service.getSpareByCode('SPAR-0001')!.在库量,
)
check('并发结果同样落库', persistedSpare('SPAR-0001')['在库量'] === 8)

// 9. 补货闭环：补足后补货单关闭
const r7 = service.submitReturn({ 单号: 'TK-TEST-003', 备件编号: 'SPAR-0002', 数量: 2, 经办人: '测试员', 库位: 'A区-02-01' })
check('SPAR-0002 退库落库', r7.ok, r7.message)
const s2b = service.getSpareByCode('SPAR-0002')!
check('SPAR-0002 恢复在库可用并取消标记', s2b.备件状态 === '在库可用' && s2b.abnormal === false)
check(
  '补货台账同步为已补足',
  service.listReplenishments().find((row) => row.备件编号 === 'SPAR-0002')!.补货状态 === '已补足',
)

// 10. 报废：终态，拒绝再出入库，补货单关闭
const r8 = service.scrapSpare('SPAR-0003', '测试员')
check('报废落库成功', r8.ok, r8.message)
const s3b = service.getSpareByCode('SPAR-0003')!
check('报废后在库量清零、库位腾空', s3b.在库量 === 0 && s3b.存放库位 === '')
check('判定为已报废', s3b.备件状态 === '已报废' && s3b.status === '已报废')
const r9 = service.submitRequisition({ 单号: 'LY-TEST-005', 备件编号: 'SPAR-0003', 数量: 1, 经办人: '测试员' })
check('已报废备件拒绝领用', !r9.ok, r9.message)
check(
  '报废后不再有待补货单',
  service.listReplenishments().find((row) => row.备件编号 === 'SPAR-0003')!.补货状态 !== '待补货',
)

// 11. 登记备品备件：编号唯一，初始待入库，补货台账同步
const r10 = service.registerSpare({
  备件编号: 'SPAR-0009',
  备件名称: '测试备件',
  规格型号: 'T-1',
  所属系统: '测试系统',
  最低储备量: 5,
  责任人员: '测试员',
})
check('登记备品备件成功', r10.ok, r10.message)
const s9 = service.getSpareByCode('SPAR-0009')!
check('新备件判定为待入库', s9.备件状态 === '待入库' && s9.在库量 === 0)
check(
  '新备件同步出待补货单',
  service
    .listReplenishments()
    .some((row) => row.备件编号 === 'SPAR-0009' && row.补货状态 === '待补货' && Number(row.需补数量) === 5),
)
const r11 = service.registerSpare({
  备件编号: 'SPAR-0009',
  备件名称: '重复登记',
  规格型号: '',
  所属系统: '',
  最低储备量: 1,
  责任人员: '',
})
check('重复编号拒绝登记', !r11.ok, r11.message)

// 11b. 带着待补货单报废：补货单同步关闭
const r11c = service.scrapSpare('SPAR-0009', '测试员')
check('带待补货单的备件报废成功', r11c.ok, r11c.message)
check(
  '待补货单同步关闭',
  service.listReplenishments().find((row) => row.备件编号 === 'SPAR-0009')!.补货状态 === '已关闭',
)

// 12. 运营概览与台账同源：异常量就是低于储备的备件数
const overview = loadOverview()
const spareModule = overview.modules.find((mod) => mod.name === '备件台账管理')!
const abnormalCount = service.listSpares().filter((row) => row.abnormal).length
check(
  '运营概览异常量与台账同一份',
  spareModule.abnormal === abnormalCount,
  `概览 ${spareModule.abnormal} / 台账 ${abnormalCount}`,
)

// 13. 最终落库快照：刷新或重进页面看到的还是扣过之后的数
check('落库快照里 SPAR-0001 在库量 8', persistedSpare('SPAR-0001')['在库量'] === 8)
check('落库快照里流水与内存一致', persisted().spare_flow.length === service.listFlows().length)

console.log(`\n${passed} 通过，${failed} 失败`)
if (failed > 0) {
  process.exit(1)
}
