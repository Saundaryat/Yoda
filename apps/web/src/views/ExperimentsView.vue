<script setup lang="ts">
import type { Configuration, ExperimentSummary } from '@evals/shared';
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import StatusBadge from '../components/StatusBadge.vue';
import { useResource } from '../composables/useResource.js';
import { dateTime, money } from '../format.js';

const { data: experiments, error } = useResource<ExperimentSummary[]>('/experiments');
const { data: configurations } = useResource<Configuration[]>('/configurations');
const configName = computed(
  () => (id: string) => configurations.value?.find((c) => c.id === id)?.name ?? '…',
);
const progress = (e: ExperimentSummary) => {
  const total = Object.values(e.counts).reduce((s, n) => s + n, 0);
  const done = e.counts.scored + e.counts.error + e.counts.cancelled;
  return total ? `${done}/${total}` : '—';
};
</script>

<template>
  <div class="page-head">
    <div>
      <h1>Experiments</h1>
      <p class="subtitle">Each experiment runs the same tasks under two configurations, A and B.</p>
    </div>
    <RouterLink to="/experiments/new" class="button primary">New experiment</RouterLink>
  </div>

  <p v-if="error" class="error">{{ error }}</p>
  <div v-else-if="experiments && !experiments.length" class="card empty">
    No experiments yet. Create configurations, then a new experiment.
  </div>
  <div v-else-if="experiments" class="card table-scroll">
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>A (baseline) → B (candidate)</th>
          <th>Status</th>
          <th class="num">Runs done</th>
          <th class="num">Spend</th>
          <th>Created</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="e in experiments" :key="e.id">
          <td>
            <RouterLink :to="`/experiments/${e.id}`">{{ e.name }}</RouterLink>
          </td>
          <td>
            <span class="side-a">{{ configName(e.baselineConfigId) }}</span>
            <span class="muted"> → </span>
            <span class="side-b">{{ configName(e.candidateConfigId) }}</span>
          </td>
          <td><StatusBadge :status="e.status" /></td>
          <td class="num">{{ progress(e) }}</td>
          <td class="num">{{ money(e.costUsd) }}</td>
          <td class="muted">{{ dateTime(e.createdAt) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
