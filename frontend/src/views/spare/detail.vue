<template>
  <section class="page" data-module="spare-detail">
    <header class="page-head">
      <div>
        <h2>备件详情 · {{ part?.code ?? code }}</h2>
        <p class="page-desc">详情与备件台账读的是同一份落库记录：刷新页面或重新进入，在库量与存放库位都保持扣减后的值。</p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn" to="/spare">返回备件台账</RouterLink>
      </div>
    </header>

    <div v-if="!part" class="data-table empty-state" style="padding: 24px">
      没有找到编号为 {{ code }} 的备件
    </div>

    <template v-else>
      <div class="stat-row">
        <article class="stat-card">
          <span class="stat-label">在库量</span>
          <strong class="stat-value" :class="{ 'qty-low': isLow }">{{ part.onHand }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">最低储备量</span>
          <strong class="stat-value">{{ part.minStock }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">存放库位</span>
          <strong class="stat-value loc-value">{{ part.location || '—' }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">备件状态（当前版本 v{{ part.version }}）</span>
          <strong class="stat-value">
            <span class="status-tag" :data-status="part.status">{{ part.status }}</span>
            <span v-if="isLow" class="low-flag">低于最低储备量</span>
          </strong>
        </article>
      </div>

      <table class="data-table detail-table">
        <tbody>
          <tr><th>备件编号</th><td>{{ part.code }}</td><th>备件名称</th><td>{{ part.name }}</td></tr>
          <tr><th>规格型号</th><td>{{ part.spec }}</td><th>所属系统</th><td>{{ part.system }}</td></tr>
          <tr><th>责任人员</th><td>{{ part.owner }}</td><th>最近落库时间</th><td>{{ part.updatedAt }}</td></tr>
          <tr v-if="replenishEntry">
            <th>补货台账</th>
            <td colspan="3">
              <span class="status-tag" :data-status="replenishEntry.status === '预警中' ? '待补货' : '在库可用'">
                {{ replenishEntry.status }}
              </span>
              预警时间 {{ replenishEntry.openedAt }}<template v-if="replenishEntry.resolvedAt">
                · 解除时间 {{ replenishEntry.resolvedAt }}</template>
            </td>
          </tr>
        </tbody>
      </table>

      <h3 class="block-title">该备件的单据记录（领用 / 退库 / 入库）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>单号</th>
            <th>类型</th>
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
            <td>{{ order.qty }}</td>
            <td>{{ order.location || '—' }}</td>
            <td>v{{ order.baseVersion }} → v{{ order.finalVersion }}</td>
            <td>{{ order.createdAt }}</td>
          </tr>
          <tr v-if="!orders.length">
            <td colspan="6" class="empty-state">该备件还没有单据</td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

import { isBelowMinimum } from '@/data/spare/derive'
import { getSparePart, listReplenishEntries, listSpareOrders } from '@/data/spare/service'
import type { ReplenishEntry, SpareOrder, SparePart } from '@/data/spare/types'

const route = useRoute()
const code = computed(() => String(route.params.code ?? ''))
const part = ref<SparePart | null>(null)
const orders = ref<SpareOrder[]>([])
const replenishEntry = ref<ReplenishEntry | null>(null)

const isLow = computed(() => (part.value ? isBelowMinimum(part.value) : false))

function reload() {
  part.value = getSparePart(code.value)
  orders.value = listSpareOrders(code.value)
  replenishEntry.value =
    listReplenishEntries().find((entry) => entry.code === code.value) ?? null
}

onMounted(reload)
</script>
