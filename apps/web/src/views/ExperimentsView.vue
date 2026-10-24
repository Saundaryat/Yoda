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
const totals = computed(() => {
  const all = experiments.value ?? [];
  return {
    experiments: all.length,
    running: all.filter((e) => e.status === 'running').length,
    scored: all.reduce((sum, e) => sum + e.counts.scored, 0),
    spend: all.reduce((sum, e) => sum + (e.costUsd ?? 0), 0),
  };
});
const runProgress = (e: ExperimentSummary) => {
  const total = Object.values(e.counts).reduce((sum, value) => sum + value, 0);
  const done = e.counts.scored + e.counts.error + e.counts.cancelled;
  return { total, done, percent: total ? Math.round((done / total) * 100) : 0 };
};
</script>

<template>
  <div class="page-head hero-head">
    <div>
      <p class="eyebrow">Evaluation workspace</p>
      <h1>Experiments</h1>
      <p class="subtitle">
        Measure whether a candidate agent actually improves—and trace every result back to evidence.
      </p>
    </div>
    <RouterLink to="/experiments/new" class="button primary"
      ><span aria-hidden="true">＋</span> New experiment</RouterLink
    >
  </div>

  <section class="summary-strip" aria-label="Workspace summary">
    <div>
      <span>Experiments</span><strong>{{ totals.experiments }}</strong>
    </div>
    <div>
      <span>Running now</span><strong>{{ totals.running }}</strong>
    </div>
    <div>
      <span>Scored runs</span><strong>{{ totals.scored }}</strong>
    </div>
    <div>
      <span>Tracked spend</span><strong>{{ money(totals.spend) }}</strong>
    </div>
  </section>

  <div class="section-head">
    <div>
      <h2>Recent comparisons</h2>
      <p>Baseline and candidate performance, side by side.</p>
    </div>
    <RouterLink to="/configurations">Manage configurations →</RouterLink>
  </div>

  <p v-if="error" class="error">{{ error }}</p>
  <div v-else-if="experiments && !experiments.length" class="card empty">
    <strong>No experiments yet</strong>
    <span>Create two configurations, then run your first controlled comparison.</span>
  </div>
  <div v-else-if="experiments" class="experiment-list">
    <RouterLink
      v-for="e in experiments"
      :key="e.id"
      :to="`/experiments/${e.id}`"
      class="experiment-card"
    >
      <div class="card-top">
        <div>
          <span class="timestamp">{{ dateTime(e.createdAt) }}</span>
          <h3>{{ e.name }}</h3>
        </div>
        <StatusBadge :status="e.status" />
      </div>

      <div class="comparison">
        <div class="config config-a">
          <span>A · baseline</span><strong>{{ configName(e.baselineConfigId) }}</strong>
        </div>
        <div class="versus" aria-hidden="true">→</div>
        <div class="config config-b">
          <span>B · candidate</span><strong>{{ configName(e.candidateConfigId) }}</strong>
        </div>
      </div>

      <div class="card-bottom">
        <div class="progress-meta">
          <span>{{ runProgress(e).done }} of {{ runProgress(e).total }} runs complete</span>
          <strong>{{ runProgress(e).percent }}%</strong>
          <div class="progress-track"><i :style="{ width: `${runProgress(e).percent}%` }" /></div>
        </div>
        <div class="spend">
          <span>Spend</span><strong>{{ money(e.costUsd) }}</strong>
        </div>
        <span class="open-arrow" aria-hidden="true">↗</span>
      </div>
    </RouterLink>
  </div>
</template>

<style scoped>
.hero-head {
  margin-bottom: 23px;
}
.eyebrow {
  margin: 0 0 7px;
  color: #777;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.summary-strip {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  margin-bottom: 35px;
  background: #fff;
  border: 1px solid #e3e3e3;
  border-radius: 9px;
  overflow: hidden;
}
.summary-strip > div {
  min-height: 96px;
  padding: 20px 22px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  border-right: 1px solid #e8e8e8;
}
.summary-strip > div:last-child {
  border: 0;
}
.summary-strip span {
  color: #777;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
}
.summary-strip strong {
  margin-top: 5px;
  color: #171717;
  font-size: 22px;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.03em;
}
.section-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
}
.section-head h2 {
  margin: 0;
  font-size: 15px;
}
.section-head p {
  margin: 3px 0 0;
  color: var(--muted);
  font-size: 11px;
}
.section-head > a {
  color: #555;
  font-size: 11px;
  font-weight: 700;
}
.empty {
  display: grid;
  gap: 4px;
}
.experiment-list {
  display: grid;
  gap: 11px;
}
.experiment-card {
  display: block;
  padding: 20px 21px 17px;
  color: var(--text);
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 9px;
  transition:
    transform 0.16s ease,
    border-color 0.16s ease,
    box-shadow 0.16s ease;
}
.experiment-card:hover {
  border-color: #bdbdbd;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.05);
}
.card-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 15px;
}
.timestamp {
  display: block;
  margin-bottom: 4px;
  color: #8a98a2;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.card-top h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 720;
}
.comparison {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 32px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  margin: 18px 0;
}
.config {
  min-width: 0;
  padding: 11px 13px;
  border-radius: 8px;
  background: #f5f7f8;
  border: 1px solid #e9edef;
}
.config-b {
  background: #f0f0f0;
  border-color: #dddddd;
}
.config span {
  display: block;
  margin-bottom: 2px;
  color: #83919b;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.config-b span {
  color: #555;
}
.config strong {
  display: block;
  overflow: hidden;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.versus {
  color: #92a0a9;
  text-align: center;
}
.card-bottom {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) auto auto;
  align-items: end;
  gap: 22px;
  padding-top: 15px;
  border-top: 1px solid var(--border);
}
.progress-meta {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 4px 10px;
  color: var(--muted);
  font-size: 10px;
}
.progress-meta strong {
  color: var(--text);
  font-size: 10px;
}
.progress-track {
  grid-column: 1 / -1;
  height: 4px;
  overflow: hidden;
  background: #e8edef;
  border-radius: 99px;
}
.progress-track i {
  display: block;
  height: 100%;
  background: #171717;
  border-radius: inherit;
}
.spend {
  display: grid;
  justify-items: end;
}
.spend span {
  color: var(--muted);
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.07em;
}
.spend strong {
  font-size: 12px;
}
.open-arrow {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  color: #171717;
  background: #eeeeee;
  border-radius: 7px;
}
@media (max-width: 900px) {
  .summary-strip {
    grid-template-columns: repeat(2, 1fr);
  }
  .summary-strip > div:nth-child(2) {
    border-right: 0;
  }
  .summary-strip > div:nth-child(-n + 2) {
    border-bottom: 1px solid #e8e8e8;
  }
}
@media (max-width: 540px) {
  .summary-strip > div {
    min-height: 76px;
    padding: 15px;
  }
  .summary-strip strong {
    font-size: 18px;
  }
  .section-head > a {
    display: none;
  }
  .comparison {
    grid-template-columns: 1fr;
  }
  .versus {
    display: none;
  }
  .card-bottom {
    grid-template-columns: 1fr auto;
    gap: 13px;
  }
  .open-arrow {
    display: none;
  }
}
</style>
