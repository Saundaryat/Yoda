<script setup lang="ts">
import type { Configuration, ExperimentSummary } from '@evals/shared';
import { computed, ref } from 'vue';
import {
  configurationName,
  experimentName,
  experimentStage,
  isDevelopmentExperiment,
} from '../names.js';
import { RouterLink } from 'vue-router';
import StatusBadge from '../components/StatusBadge.vue';
import { useResource } from '../composables/useResource.js';
import { dateTime, money, percent, points, VERDICT } from '../format.js';

const { data: experiments, error } = useResource<ExperimentSummary[]>('/experiments');
const { data: configurations } = useResource<Configuration[]>('/configurations');
const configName = computed(
  () => (id: string) => configurationName(configurations.value?.find((c) => c.id === id)),
);
const showHistory = ref(false);
const shown = computed(() =>
  (experiments.value ?? [])
    .filter((e) => showHistory.value || (!e.correctedExperimentId && !isDevelopmentExperiment(e)))
    .sort(
      (a, b) =>
        (experimentStage(a) ?? 100) - (experimentStage(b) ?? 100) ||
        a.createdAt.localeCompare(b.createdAt),
    ),
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
        Compare agent versions. See what changed, what passed, and the evidence behind each result.
      </p>
    </div>
    <RouterLink to="/experiments/new" class="button primary"
      ><span aria-hidden="true">＋</span> New experiment</RouterLink
    >
  </div>

  <section v-if="experiments" class="summary-strip" aria-label="Workspace summary">
    <div>
      <span>Experiments</span><strong>{{ totals.experiments }}</strong>
    </div>
    <div>
      <span>Running now</span><strong>{{ totals.running }}</strong>
    </div>
    <div>
      <span>Scored records</span><strong>{{ totals.scored }}</strong
      ><small>Includes rescoring</small>
    </div>
    <div>
      <span>Tracked spend</span><strong>{{ money(totals.spend) }}</strong>
    </div>
  </section>

  <div class="section-head">
    <div>
      <h2>Experiment progression</h2>
      <p>Follow the numbered tests. A is the starting version; B is the proposed change.</p>
    </div>
    <RouterLink to="/configurations">Manage configurations →</RouterLink>
  </div>

  <div class="list-toolbar">
    <p v-if="experiments" class="list-count">
      <strong>{{ shown.length }} comparisons</strong
      ><span>of {{ experiments.length }} saved records</span>
    </p>
    <label class="history-toggle"
      ><input
        v-model="showHistory"
        type="checkbox"
        aria-label="Show development checks and replaced scores"
      /><span>Include historical results</span></label
    >
  </div>
  <p v-if="error" class="error">{{ error }}</p>
  <p v-else-if="!experiments" class="muted" role="status">Loading comparisons…</p>
  <div v-else-if="experiments && !experiments.length" class="card empty">
    <strong>No experiments yet</strong>
    <span>Create two configurations, then run your first controlled comparison.</span>
  </div>
  <div v-else-if="experiments && !shown.length" class="card empty">
    <strong>No current comparisons</strong
    ><span
      >Enable “Include historical results” to inspect development checks and replaced scores.</span
    >
  </div>
  <div v-else-if="experiments" class="experiment-list">
    <RouterLink
      v-for="e in shown"
      :key="e.id"
      :to="`/experiments/${e.id}`"
      class="experiment-card"
      :data-verdict="e.result?.verdict"
    >
      <div class="card-top">
        <div>
          <span class="timestamp">{{ dateTime(e.createdAt) }}</span>
          <h3>{{ experimentName(e) }}</h3>
          <p class="experiment-kind">
            {{
              e.correctedExperimentId
                ? 'Original scores · replaced by a correction'
                : e.rescoring
                  ? `Rescored saved conversations · ${e.rescoring.evaluatorVersion} · no new agent run`
                  : e.status === 'draft'
                    ? 'Ready to run · no conversations started'
                    : 'New conversation batch'
            }}
          </p>
        </div>
        <StatusBadge :status="e.status" />
      </div>

      <div class="comparison">
        <div class="config config-a">
          <span>A · Starting version</span><strong>{{ configName(e.baselineConfigId) }}</strong>
        </div>
        <div class="versus" aria-hidden="true">→</div>
        <div class="config config-b">
          <span>B · Proposed version</span><strong>{{ configName(e.candidateConfigId) }}</strong>
        </div>
      </div>

      <div v-if="e.result" class="published-result" aria-label="Experiment result">
        <div>
          <span>A pass rate</span
          ><strong>{{ e.result.pairedTasks ? percent(e.result.passRateA) : '—' }}</strong>
        </div>
        <div>
          <span>B pass rate</span
          ><strong>{{ e.result.pairedTasks ? percent(e.result.passRateB) : '—' }}</strong>
        </div>
        <div>
          <span>Change</span
          ><strong>{{ e.result.pairedTasks ? points(e.result.difference) : '—' }}</strong>
        </div>
        <div class="result-decision">
          <span>{{ e.status === 'running' ? 'Provisional' : 'Result' }}</span
          ><strong>{{ VERDICT[e.result.verdict].label }}</strong
          ><small v-if="e.result.verdict === 'inconclusive'">{{
            e.result.pairedTasks < 10 ? 'Limited scenario coverage' : 'No clear winner'
          }}</small>
        </div>
      </div>
      <div class="card-bottom">
        <div v-if="e.status === 'running'" class="progress-meta">
          <span>{{ runProgress(e).done }} of {{ runProgress(e).total }} runs complete</span>
          <strong>{{ runProgress(e).percent }}%</strong>
          <div class="progress-track"><i :style="{ width: `${runProgress(e).percent}%` }" /></div>
        </div>
        <span v-else class="completion-note"
          >{{ e.status === 'draft' ? 'Ready to start' : `${e.counts.scored} runs scored`
          }}<template v-if="e.counts.error"> · {{ e.counts.error }} errors</template></span
        >
        <div class="spend">
          <span>Spend</span><strong>{{ money(e.costUsd) }}</strong>
        </div>
        <span class="open-arrow" aria-hidden="true">View comparison <span>↗</span></span>
      </div>
    </RouterLink>
  </div>
</template>

<style scoped src="../styles/experiments.css" />
