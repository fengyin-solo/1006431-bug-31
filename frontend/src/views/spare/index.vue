<template>
  <section class="page" data-module="spare">
    <header class="page-head">
      <div>
        <h2>备件台账管理</h2>
        <p class="page-desc">维护备品备件，围绕备件编号、备件名称、规格型号、所属系统做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记备品备件</button>
        <button class="btn" type="button" @click="exportRows">导出备件台账清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.备件编号" :class="{ 'low-stock': row.abnormal }">
          <td>{{ row.备件编号 }}</td>
          <td>{{ row.备件名称 }}</td>
          <td>{{ row.规格型号 }}</td>
          <td>{{ row.所属系统 }}</td>
          <td>{{ row.存放库位 || '—' }}</td>
          <td>
            {{ row.在库量 }}
            <span v-if="row.abnormal" class="badge warn">低于储备</span>
          </td>
          <td>{{ row.最低储备量 }}</td>
          <td>{{ row.责任人员 }}</td>
          <td>
            <span class="badge" :class="statusBadge(row.备件状态)">{{ row.备件状态 }}</span>
          </td>
          <td class="row-actions">
            <button class="link" type="button" @click="openDetail(row)">详情</button>
            <button
              v-if="row.status !== '已报废'"
              class="link"
              type="button"
              :disabled="row.在库量 <= 0"
              @click="openFlow('领用', row)"
            >
              办理领用
            </button>
            <button v-if="row.status !== '已报废'" class="link" type="button" @click="openFlow('退库', row)">
              办理退库
            </button>
            <button v-if="row.status === '待入库'" class="link" type="button" @click="openFlow('入库', row)">
              登记入库
            </button>
            <button v-if="row.status !== '已报废'" class="link" type="button" @click="scrapRow(row)">
              报废备件
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 1" class="empty-state">暂无备件台账数据，可先登记备品备件</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条备件台账记录</span>
      <span v-if="message" class="success-text">{{ message }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <section v-if="detailRow" class="detail-panel">
      <header class="detail-head">
        <h3>备件详情：{{ detailRow.备件编号 }}</h3>
        <button class="btn ghost" type="button" @click="selectedCode = ''">收起</button>
      </header>
      <div class="detail-grid">
        <div class="kv"><span>备件名称</span>{{ detailRow.备件名称 }}</div>
        <div class="kv"><span>规格型号</span>{{ detailRow.规格型号 }}</div>
        <div class="kv"><span>所属系统</span>{{ detailRow.所属系统 }}</div>
        <div class="kv"><span>存放库位</span>{{ detailRow.存放库位 || '—' }}</div>
        <div class="kv"><span>在库量</span>{{ detailRow.在库量 }}</div>
        <div class="kv"><span>最低储备量</span>{{ detailRow.最低储备量 }}</div>
        <div class="kv"><span>责任人员</span>{{ detailRow.责任人员 }}</div>
        <div class="kv"><span>备件状态</span>{{ detailRow.备件状态 }}</div>
        <div class="kv"><span>数据版本</span>v{{ detailRow.version }}</div>
      </div>
      <h4 class="section-title">出入库流水</h4>
      <table class="data-table">
        <thead>
          <tr>
            <th>单号</th><th>单据类型</th><th>数量</th><th>经办人</th>
            <th>办理时间</th><th>落库后在库量</th><th>落库后库位</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="flow in detailFlows" :key="flow.单号">
            <td>{{ flow.单号 }}</td>
            <td>{{ flow.单据类型 }}</td>
            <td>{{ flow.数量 }}</td>
            <td>{{ flow.经办人 }}</td>
            <td>{{ flow.办理时间 }}</td>
            <td>{{ flow.落库后在库量 }}</td>
            <td>{{ flow.落库后库位 }}</td>
          </tr>
          <tr v-if="!detailFlows.length">
            <td colspan="7" class="empty-state">该备件还没有出入库流水</td>
          </tr>
        </tbody>
      </table>
    </section>

    <h3 class="section-title">补货台账（由备件状态判定同步生成）</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>补货单号</th><th>备件编号</th><th>备件名称</th><th>当前在库量</th>
          <th>最低储备量</th><th>需补数量</th><th>补货状态</th><th>生成时间</th><th>关闭时间</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in replenishments" :key="row.补货单号" :class="{ 'low-stock': row.补货状态 === '待补货' }">
          <td>{{ row.补货单号 }}</td>
          <td>{{ row.备件编号 }}</td>
          <td>{{ row.备件名称 }}</td>
          <td>{{ row.当前在库量 }}</td>
          <td>{{ row.最低储备量 }}</td>
          <td>{{ row.需补数量 }}</td>
          <td>
            <span class="badge" :class="row.补货状态 === '待补货' ? 'warn' : 'muted'">{{ row.补货状态 }}</span>
          </td>
          <td>{{ row.生成时间 }}</td>
          <td>{{ row.关闭时间 || '—' }}</td>
        </tr>
        <tr v-if="!replenishments.length">
          <td colspan="9" class="empty-state">暂无补货记录，低于最低储备量的备件会自动出现在这里</td>
        </tr>
      </tbody>
    </table>

    <div v-if="dialog" class="modal-mask" @click.self="closeDialog">
      <div class="modal-card">
        <h3>{{ dialogTitle }}</h3>
        <div class="form-grid">
          <template v-if="dialog === 'create'">
            <label class="form-item"><span>备件编号</span><input v-model="form.备件编号" placeholder="如 SPAR-0004" /></label>
            <label class="form-item"><span>备件名称</span><input v-model="form.备件名称" /></label>
            <label class="form-item"><span>规格型号</span><input v-model="form.规格型号" /></label>
            <label class="form-item"><span>所属系统</span><input v-model="form.所属系统" /></label>
            <label class="form-item"><span>最低储备量</span><input v-model.number="form.最低储备量" type="number" min="0" /></label>
            <label class="form-item"><span>责任人员</span><input v-model="form.责任人员" /></label>
          </template>
          <template v-else>
            <p class="hint-text">
              备件 {{ form.备件编号 }} · 当前在库量 {{ form.当前在库量 }} · 当前库位 {{ form.当前库位 || '—' }}
            </p>
            <label class="form-item"><span>{{ dialog }}单号</span><input v-model="form.单号" /></label>
            <label class="form-item"><span>数量</span><input v-model.number="form.数量" type="number" min="1" /></label>
            <label v-if="dialog !== '领用'" class="form-item">
              <span>存放库位</span><input v-model="form.库位" placeholder="退库/入库后的存放库位" />
            </label>
            <label class="form-item"><span>经办人</span><input v-model="form.经办人" /></label>
          </template>
        </div>
        <p v-if="dialogError" class="error-text">{{ dialogError }}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeDialog">取消</button>
          <button class="btn primary" type="button" @click="submitDialog">提交</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { downloadEntries, moduleMeta } from '@/api/local-service'
import {
  listReplenishments,
  listFlows,
  listSpares,
  registerSpare,
  scrapSpare,
  spareStats,
  submitInbound,
  submitRequisition,
  submitReturn,
  suggestFlowNo,
} from '@/api/spare-service'
import type { FlowResult } from '@/api/spare-service'
import type { ReplenishmentRow, SpareFlow, SpareRow } from '@/data/types'

const meta = moduleMeta('spare')
const columns = ['备件编号', '备件名称', '规格型号', '所属系统', '存放库位', '在库量', '最低储备量', '责任人员', '备件状态']
const filterFields = columns.slice(0, 3)
const statusOptions = ['待入库', '在库可用', '低于储备', '已领空', '已报废']

const rows = ref<SpareRow[]>([])
const flows = ref<SpareFlow[]>([])
const replenishments = ref<ReplenishmentRow[]>([])
const stats = ref<{ label: string; value: number }[]>([])
const total = ref(0)
const filters = ref<Record<string, string>>({})
const message = ref('')
const errorMessage = ref('')

const selectedCode = ref('')
// 详情与列表读的是同一份台账：直接从列表数据里按备件编号取，不另开数据源
const detailRow = computed(() => rows.value.find((row) => row.备件编号 === selectedCode.value) ?? null)
const detailFlows = computed(() =>
  flows.value.filter((flow) => flow.备件编号 === selectedCode.value).slice().reverse(),
)

const statusSummary = computed(() =>
  statusOptions.map((status) => ({
    status,
    count: rows.value.filter((row) => row.备件状态 === status).length,
  })),
)

type FlowDialog = '领用' | '退库' | '入库'
const dialog = ref<'' | 'create' | FlowDialog>('')
const dialogError = ref('')
const form = ref({
  单号: '',
  备件编号: '',
  数量: 1,
  库位: '',
  经办人: '值班管理员',
  当前在库量: 0,
  当前库位: '',
  expectedVersion: 0,
  备件名称: '',
  规格型号: '',
  所属系统: '',
  最低储备量: 0,
  责任人员: '',
})

const dialogTitle = computed(() => {
  if (dialog.value === 'create') return '登记备品备件'
  return dialog.value ? `办理${dialog.value}：${form.value.备件编号}` : ''
})

function statusBadge(status: string): string {
  if (status === '低于储备' || status === '已领空') return 'warn'
  if (status === '在库可用') return 'info'
  return 'muted'
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openDetail(row: SpareRow) {
  selectedCode.value = row.备件编号
}

function openCreate() {
  dialogError.value = ''
  form.value = { ...form.value, 备件编号: '', 备件名称: '', 规格型号: '', 所属系统: '', 最低储备量: 0, 责任人员: '' }
  dialog.value = 'create'
}

function openFlow(kind: FlowDialog, row: SpareRow) {
  dialogError.value = ''
  form.value = {
    ...form.value,
    单号: suggestFlowNo(kind, row.备件编号),
    备件编号: row.备件编号,
    数量: 1,
    库位: row.存放库位,
    当前在库量: row.在库量,
    当前库位: row.存放库位,
    // 记下打开单据时读到的版本：提交时若已落库的版本变了，以先落库的为准重算
    expectedVersion: row.version,
  }
  dialog.value = kind
}

function closeDialog() {
  dialog.value = ''
  dialogError.value = ''
}

function applyResult(result: FlowResult) {
  if (!result.ok) {
    dialogError.value = result.message
    return
  }
  closeDialog()
  message.value = result.message
  errorMessage.value = ''
  reload()
}

function submitDialog() {
  message.value = ''
  errorMessage.value = ''
  if (dialog.value === 'create') {
    applyResult(
      registerSpare({
        备件编号: form.value.备件编号,
        备件名称: form.value.备件名称,
        规格型号: form.value.规格型号,
        所属系统: form.value.所属系统,
        最低储备量: form.value.最低储备量,
        责任人员: form.value.责任人员,
      }),
    )
    return
  }
  const input = {
    单号: form.value.单号,
    备件编号: form.value.备件编号,
    数量: form.value.数量,
    经办人: form.value.经办人,
    库位: form.value.库位,
    expectedVersion: form.value.expectedVersion,
  }
  if (dialog.value === '领用') {
    applyResult(submitRequisition(input))
  } else if (dialog.value === '退库') {
    applyResult(submitReturn(input))
  } else if (dialog.value === '入库') {
    applyResult(submitInbound(input))
  }
}

function scrapRow(row: SpareRow) {
  message.value = ''
  errorMessage.value = ''
  if (!window.confirm(`确定报废备件 ${row.备件编号}（${row.备件名称}）吗？在库量将清零，不可恢复。`)) {
    return
  }
  const result = scrapSpare(row.备件编号, '值班管理员', row.version)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  message.value = result.message
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    rows.value = listSpares(filters.value)
    total.value = rows.value.length
    flows.value = listFlows()
    replenishments.value = listReplenishments()
    stats.value = spareStats()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '备件台账列表读取失败'
  }
}

onMounted(reload)
</script>
