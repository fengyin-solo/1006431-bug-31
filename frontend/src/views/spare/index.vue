<template>
  <section class="page" data-module="spare">
    <header class="page-head">
      <div>
        <h2>备件台账管理</h2>
        <p class="page-desc">备件按编号取数：领用、退库、入库一次落库，在库量与存放库位写在同一份记录上，列表、详情与运营概览读到的都是同一份。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出备件台账清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in statCards" :key="item.label" class="stat-card" :class="{ alert: item.alert }">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
      <span class="legend-item legend-tip">标红行 = 在库量低于最低储备量</span>
    </p>

    <div class="tabs" role="tablist">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        type="button"
        class="tab"
        :class="{ active: activeTab === tab.key }"
        @click="switchTab(tab.key)"
      >
        {{ tab.label }}
        <em v-if="tab.key === 'replenish' && openReplenishCount" class="tab-badge">{{ openReplenishCount }}</em>
      </button>
    </div>

    <form v-if="activeTab === 'parts'" class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table v-if="activeTab === 'parts'" class="data-table">
      <thead>
        <tr>
          <th v-for="column in partColumns" :key="column">{{ column }}</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in parts" :key="row.code" :class="{ 'low-stock': isLow(row) }">
          <td>
            <RouterLink class="link" :to="`/spare/${encodeURIComponent(row.code)}`">{{ row.code }}</RouterLink>
            <span class="row-version">v{{ row.version }}</span>
          </td>
          <td>{{ row.name }}</td>
          <td>{{ row.spec }}</td>
          <td>{{ row.system }}</td>
          <td>{{ row.location || '—' }}</td>
          <td>
            <strong :class="{ 'qty-low': isLow(row) }">{{ row.onHand }}</strong>
          </td>
          <td>{{ row.minStock }}</td>
          <td>{{ row.owner }}</td>
          <td>
            <span class="status-tag" :data-status="row.status">{{ row.status }}</span>
            <span v-if="isLow(row)" class="low-flag">低于最低储备量</span>
          </td>
          <td class="row-actions">
            <button
              v-for="action in availableActions(row.status)"
              :key="action"
              class="link"
              type="button"
              @click="openDialog(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!parts.length">
          <td :colspan="partColumns.length + 1" class="empty-state">暂无符合条件的备件</td>
        </tr>
      </tbody>
    </table>

    <table v-else-if="activeTab === 'replenish'" class="data-table">
      <thead>
        <tr>
          <th>备件编号</th>
          <th>备件名称</th>
          <th>在库量</th>
          <th>最低储备量</th>
          <th>备件状态</th>
          <th>台账状态</th>
          <th>预警时间</th>
          <th>解除时间</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="entry in replenishEntries" :key="entry.code" :class="{ 'low-stock': entry.status === '预警中' }">
          <td>
            <RouterLink class="link" :to="`/spare/${encodeURIComponent(entry.code)}`">{{ entry.code }}</RouterLink>
          </td>
          <td>{{ entry.name }}</td>
          <td :class="{ 'qty-low': entry.status === '预警中' }">{{ entry.onHand }}</td>
          <td>{{ entry.minStock }}</td>
          <td>
            <span class="status-tag" :data-status="entry.partStatus">{{ entry.partStatus }}</span>
          </td>
          <td>
            <span class="status-tag" :data-status="entry.status === '预警中' ? '待补货' : '在库可用'">{{ entry.status }}</span>
          </td>
          <td>{{ entry.openedAt }}</td>
          <td>{{ entry.resolvedAt || '—' }}</td>
        </tr>
        <tr v-if="!replenishEntries.length">
          <td colspan="8" class="empty-state">暂无补货预警，所有在库备件都不低于最低储备量</td>
        </tr>
      </tbody>
    </table>

    <table v-else class="data-table">
      <thead>
        <tr>
          <th>单号</th>
          <th>类型</th>
          <th>备件编号</th>
          <th>数量</th>
          <th>库位</th>
          <th>版本变化</th>
          <th>提交时间</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="order in orders" :key="order.orderNo">
          <td>{{ order.orderNo }}</td>
          <td>{{ order.type }}</td>
          <td>
            <RouterLink class="link" :to="`/spare/${encodeURIComponent(order.code)}`">{{ order.code }}</RouterLink>
          </td>
          <td>{{ order.qty }}</td>
          <td>{{ order.location || '—' }}</td>
          <td>v{{ order.baseVersion }} → v{{ order.finalVersion }}</td>
          <td>{{ order.createdAt }}</td>
        </tr>
        <tr v-if="!orders.length">
          <td colspan="7" class="empty-state">还没有领用 / 退库 / 入库单据</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ parts.length }} 条备件记录 · 补货预警 {{ openReplenishCount }} 条 · 数据已落库到本机浏览器</span>
      <button class="link" type="button" @click="resetAll">恢复备件示例数据</button>
      <span v-if="message" :class="messageKind">{{ message }}</span>
    </footer>

    <div v-if="dialog.open" class="modal-mask" @click.self="closeDialog">
      <div class="modal">
        <h3>{{ dialog.action }} · {{ dialog.part?.code }}</h3>
        <p class="modal-tip">{{ dialogTip }}</p>
        <div class="modal-grid">
          <label class="filter-item">
            <span>单号</span>
            <input v-model="dialog.orderNo" placeholder="同一张单号重复提交只扣一次" />
          </label>
          <label v-if="needQty" class="filter-item">
            <span>数量（正整数）</span>
            <input v-model.number="dialog.qty" type="number" min="1" :max="dialog.part?.onHand ?? undefined" />
          </label>
          <label v-if="needLocation" class="filter-item">
            <span>{{ dialog.action === '办理退库' ? '退入库位' : '入库库位' }}</span>
            <input v-model="dialog.location" placeholder="在库量与库位将一起落库" />
          </label>
          <div v-if="dialog.action === '办理领用'" class="filter-item">
            <span>当前存放库位（领空自动移出）</span>
            <input :value="dialog.part?.location || '—'" disabled />
          </div>
          <div class="filter-item">
            <span>当前在库量 / 最低储备量 / 版本</span>
            <input
              :value="`${dialog.part?.onHand ?? 0} / ${dialog.part?.minStock ?? 0} / v${dialog.part?.version ?? 0}`"
              disabled
            />
          </div>
        </div>
        <p v-if="dialog.error" class="error-text">{{ dialog.error }}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeDialog">取消</button>
          <button class="btn primary" type="button" :disabled="submitting" @click="submitDialog">
            {{ submitting ? '提交中…' : '提交' }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'

import { downloadEntries } from '@/api/local-service'
import { isBelowMinimum } from '@/data/spare/derive'
import {
  exportSpareCsv,
  listReplenishEntries,
  listSpareOrders,
  listSpareParts,
  resetSpare,
  submitSpareOrder,
} from '@/data/spare/service'
import type { ReplenishEntry, SpareOrder, SpareOrderType, SparePart } from '@/data/spare/types'

const partColumns = ['备件编号', '备件名称', '规格型号', '所属系统', '存放库位', '在库量', '最低储备量', '责任人员', '备件状态']
const filterFields = ['备件编号', '备件名称', '规格型号']
const statuses = ['待入库', '在库可用', '待补货', '已领用', '已报废']
const tabs = [
  { key: 'parts', label: '备件台账' },
  { key: 'replenish', label: '补货台账' },
  { key: 'orders', label: '单据记录' },
] as const

type TabKey = (typeof tabs)[number]['key']

const activeTab = ref<TabKey>('parts')
const parts = ref<SparePart[]>([])
const replenishEntries = ref<ReplenishEntry[]>([])
const orders = ref<SpareOrder[]>([])
const filters = ref<Record<string, string>>({})
const message = ref('')
const messageKind = ref('')
const submitting = ref(false)

const dialog = ref<{
  open: boolean
  action: SpareOrderType
  part: SparePart | null
  orderNo: string
  qty: number | null
  location: string
  error: string
}>({
  open: false,
  action: '办理领用',
  part: null,
  orderNo: '',
  qty: null,
  location: '',
  error: '',
})

const needQty = computed(() => dialog.value.action !== '报废备件')
const needLocation = computed(() => dialog.value.action === '登记入库' || dialog.value.action === '办理退库')
const dialogTip = computed(() => {
  switch (dialog.value.action) {
    case '办理领用':
      return '在库量扣减与存放库位变更会在同一次提交里落库；提交版本以当前页面读到的为准。'
    case '办理退库':
      return '退库数量加回到在库量，并落到指定库位；若与领用并发，先落库的那一版为准。'
    case '登记入库':
      return '入库后在库量、存放库位与备件状态一次性落库。'
    default:
      return '报废后备件进入已报废态，不再参与领用、退库与补货预警。'
  }
})

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: parts.value.filter((row) => row.status === status).length,
  })),
)

const openReplenishCount = computed(
  () => replenishEntries.value.filter((entry) => entry.status === '预警中').length,
)

const statCards = computed(() => [
  { label: '在库可用备件', value: parts.value.filter((p) => p.status === '在库可用').length, alert: false },
  { label: '低于最低储备量', value: openReplenishCount.value, alert: openReplenishCount.value > 0 },
  { label: '已领用备件', value: parts.value.filter((p) => p.status === '已领用').length, alert: false },
  { label: '待入库备件', value: parts.value.filter((p) => p.status === '待入库').length, alert: false },
])

function isLow(part: SparePart): boolean {
  return isBelowMinimum(part)
}

function availableActions(status: SparePart['status']): SpareOrderType[] {
  switch (status) {
    case '待入库':
      return ['登记入库']
    case '在库可用':
    case '待补货':
      return ['办理领用', '办理退库', '报废备件']
    case '已领用':
      return ['办理退库', '登记入库', '报废备件']
    default:
      return []
  }
}

function orderPrefix(action: SpareOrderType): string {
  switch (action) {
    case '登记入库':
      return 'RK'
    case '办理领用':
      return 'LY'
    case '办理退库':
      return 'TK'
    default:
      return 'BF'
  }
}

function defaultOrderNo(action: SpareOrderType): string {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const rand = Math.floor(1000 + Math.random() * 9000)
  return `${orderPrefix(action)}-${stamp}-${rand}`
}

function switchTab(tab: TabKey) {
  activeTab.value = tab
  reload()
}

function reload() {
  message.value = ''
  if (activeTab.value === 'parts') {
    parts.value = listSpareParts(filters.value)
  } else if (activeTab.value === 'replenish') {
    replenishEntries.value = listReplenishEntries()
  } else {
    orders.value = listSpareOrders()
  }
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  if (activeTab.value === 'parts') {
    const { filename, content } = exportSpareCsv()
    downloadEntriesFile(filename, content)
    return
  }
  downloadEntries('spare')
}

function downloadEntriesFile(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

function openDialog(action: SpareOrderType, part: SparePart) {
  dialog.value = {
    open: true,
    action,
    part,
    orderNo: defaultOrderNo(action),
    qty: action === '办理领用' ? 1 : null,
    location: part.location,
    error: '',
  }
}

function closeDialog() {
  dialog.value.open = false
}

function submitDialog() {
  const part = dialog.value.part
  if (!part) return
  submitting.value = true
  dialog.value.error = ''
  const result = submitSpareOrder({
    orderNo: dialog.value.orderNo,
    type: dialog.value.action,
    code: part.code,
    qty: dialog.value.qty ?? undefined,
    location: dialog.value.location,
    expectedVersion: part.version,
  })
  submitting.value = false
  if (result.ok) {
    message.value = result.message
    dialog.value.open = false
    reload()
    return
  }
  dialog.value.error = result.message
  // 并发冲突或数据已变：以先落库那一版为准，重新取数刷新页面与弹窗。
  if (result.conflict || result.part) {
    parts.value = listSpareParts(filters.value)
    replenishEntries.value = listReplenishEntries()
    const fresh = parts.value.find((item) => item.code === part.code)
    if (fresh) dialog.value.part = fresh
  }
}

function resetAll() {
  resetSpare()
  message.value = '备件数据已恢复为示例数据'
  messageKind.value = ''
  reload()
}

onMounted(reload)
</script>
