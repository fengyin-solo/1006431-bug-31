<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标，先看总量再看异常。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="refresh">重新统计</button>
      </div>
    </header>
    <div class="stat-row">
      <article v-for="card in cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
    </div>
    <table class="data-table">
      <thead>
        <tr><th>业务模块</th><th>今日新增</th><th>待处理</th><th>异常量</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in moduleRows" :key="row.name" :class="{ 'low-stock': row.name === '备件台账管理' && row.pending > 0 }">
          <td>{{ row.name }}</td>
          <td>{{ row.created }}</td>
          <td>{{ row.pending }}</td>
          <td>{{ row.abnormal }}</td>
        </tr>
      </tbody>
    </table>

    <h3 class="block-title">备件库存预警（与备件台账、补货台账同一份数据）</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>备件编号</th>
          <th>备件名称</th>
          <th>在库量</th>
          <th>最低储备量</th>
          <th>备件状态</th>
          <th>台账状态</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="entry in spareAlerts" :key="entry.code" class="low-stock">
          <td>
            <RouterLink class="link" :to="`/spare/${encodeURIComponent(entry.code)}`">{{ entry.code }}</RouterLink>
          </td>
          <td>{{ entry.name }}</td>
          <td class="qty-low">{{ entry.onHand }}</td>
          <td>{{ entry.minStock }}</td>
          <td>
            <span class="status-tag" :data-status="entry.partStatus">{{ entry.partStatus }}</span>
          </td>
          <td>
            <span class="status-tag" data-status="待补货">{{ entry.status }}</span>
          </td>
        </tr>
        <tr v-if="!spareAlerts.length">
          <td colspan="6" class="empty-state">暂无低于最低储备量的备件</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'

import { loadOverview } from '@/api/local-service'
import { listReplenishEntries } from '@/data/spare/service'
import type { ReplenishEntry } from '@/data/spare/types'
import type { OverviewResult } from '@/data/types'

const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
const spareAlerts = ref<ReplenishEntry[]>([])

function refresh() {
  const payload = loadOverview()
  cards.value = payload.cards
  moduleRows.value = payload.modules
  spareAlerts.value = listReplenishEntries().filter((entry) => entry.status === '预警中')
}

onMounted(refresh)
</script>
