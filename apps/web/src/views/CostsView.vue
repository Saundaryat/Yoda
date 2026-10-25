<script setup lang="ts">
import type { CostBreakdown } from '@evals/shared';
import { computed, toRef } from 'vue';
import { RouterLink } from 'vue-router';
import { useResource } from '../composables/useResource.js';
import { useExperimentEvents } from '../composables/useExperimentEvents.js';

const props = defineProps<{ id: string }>();
const costs = useResource<CostBreakdown>(computed(() => `/experiments/${props.id}/costs`));
const data = costs.data;
useExperimentEvents(toRef(props, 'id'), () => void costs.reload());
const dollars = (value: number) => `$${value.toFixed(value > 0 && value < 0.01 ? 6 : 2)}`;
const modelName = (value: string | null) => {
  if (!value) return 'Model not recorded';
  const match = /^claude-([a-z]+)-(\d+)-(\d+)$/.exec(value);
  if (!match) return value.replace(/^jev-/, 'Jev ');
  const family = match[1]!;
  return `Claude ${family[0]!.toUpperCase()}${family.slice(1)} ${match[2]}.${match[3]}`;
};
</script>

<template>
  <div class="cost-page">
    <RouterLink :to="`/experiments/${id}`" class="back-link">← Back to experiment</RouterLink>
    <header>
      <p class="eyebrow">Experiment costs</p>
      <h1>Where the estimate goes</h1>
      <p class="muted">{{ data?.name ?? 'Cost breakdown' }}</p>
    </header>
    <div v-if="costs.error.value" class="card error" role="alert">
      Could not load costs: {{ costs.error.value }}
      <button class="text-action" @click="costs.reload()">Try again</button>
    </div>
    <p v-else-if="costs.loading.value && !data" role="status">Loading cost estimates…</p>
    <template v-if="data">
      <section class="cost-total card" aria-label="Estimated total">
        <div>
          <span class="eyebrow">{{
            data.unknownEstimates ? 'Known estimate · incomplete' : 'Recorded estimate'
          }}</span>
          <strong>{{ dollars(data.estimatedCostUsd) }}</strong>
          <span class="muted">USD · saved API usage estimates</span>
        </div>
        <p>
          Each amount covers a different job in the experiment. Only components with recorded work
          are shown.
        </p>
      </section>
      <p v-if="data.unknownEstimates" class="cost-warning" role="status">
        {{ data.unknownEstimates }} component estimate(s) are unavailable. They are marked below and
        excluded from the known total.
      </p>
      <section class="card breakdown" aria-labelledby="breakdown-title">
        <h2 id="breakdown-title">Cost breakdown</h2>
        <div v-if="data.rows.length" class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Component</th>
                <th>What it does</th>
                <th class="amount">Estimated cost</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in data.rows" :key="row.id">
                <td>
                  <strong>{{ row.label }}</strong
                  ><small
                    >{{ modelName(row.model) }} · {{ row.runs }}
                    {{ row.runs === 1 ? 'run' : 'runs' }}</small
                  >
                </td>
                <td>{{ row.description }}</td>
                <td class="amount">
                  <strong>{{
                    row.unknownEstimates && !row.estimatedCostUsd
                      ? 'Unknown'
                      : dollars(row.estimatedCostUsd)
                  }}</strong>
                  <small v-if="row.unknownEstimates"
                    >{{ row.unknownEstimates }} estimate(s) missing</small
                  >
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <th colspan="2">{{ data.unknownEstimates ? 'Known total' : 'Total estimate' }}</th>
                <td class="amount">{{ dollars(data.estimatedCostUsd) }}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p v-else class="muted">No costed work has been recorded for this experiment yet.</p>
      </section>
      <aside class="cost-note">
        <strong>How to read this</strong>
        <p>
          These are usage-based estimates, not verified provider charges. Agent costs come from
          Hermes; customer and grading costs use saved model-rate estimates. The Claude judge amount
          excludes the reviewer and Jev, so nothing is counted twice.
        </p>
        <p>
          Scripted customers make no customer-model calls. Earlier attempts and interrupted calls
          may be missing from saved totals<span v-if="data.retriedRuns"
            >; {{ data.retriedRuns }} runs in this experiment were retried</span
          >.
        </p>
      </aside>
    </template>
  </div>
</template>

<style scoped>
.cost-page {
  max-width: 1040px;
  margin: 0 auto;
}
.back-link {
  display: inline-block;
  margin-bottom: 28px;
  font-size: 12px;
}
header {
  margin-bottom: 28px;
}
h1 {
  margin: 8px 0 12px;
}
h2 {
  font-size: 16px;
  margin: 0 0 20px;
}
.eyebrow {
  color: var(--muted);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.cost-total {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 36px;
  margin-bottom: 24px;
  padding: 28px;
}
.cost-total > div {
  display: grid;
  gap: 10px;
  flex-shrink: 0;
}
.cost-total strong {
  font-size: 40px;
  font-weight: 600;
  letter-spacing: -0.04em;
}
.cost-total p {
  max-width: 360px;
  color: var(--muted);
  line-height: 1.7;
  font-size: 13px;
}
.breakdown {
  padding: 24px;
}
.table-scroll {
  overflow-x: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
th {
  color: var(--muted);
  text-align: left;
  font-size: 11px;
  font-weight: 500;
  padding: 0 16px 14px 0;
}
td {
  padding: 20px 18px 20px 0;
  border-top: 1px solid var(--border, #e8e8e8);
  line-height: 1.6;
}
td:first-child {
  min-width: 190px;
}
td:nth-child(2) {
  color: var(--muted);
}
small {
  display: block;
  color: var(--muted);
  font-size: 11px;
  margin-top: 5px;
}
.amount {
  text-align: right;
  padding-right: 0;
  min-width: 130px;
  font-variant-numeric: tabular-nums;
}
.amount strong {
  font-weight: 600;
}
tfoot th,
tfoot td {
  padding-top: 20px;
  border-top: 1px solid var(--border, #e8e8e8);
  font-size: 14px;
  font-weight: 600;
  color: inherit;
}
.cost-note {
  margin-top: 24px;
  padding: 0 2px;
  max-width: 820px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.75;
}
.cost-note strong {
  color: var(--text);
  font-size: 12px;
}
.cost-note p {
  margin: 8px 0;
}
.cost-warning {
  padding: 12px 16px;
  background: #fff7df;
  border-radius: 8px;
  font-size: 12px;
}
@media (max-width: 650px) {
  .cost-total {
    align-items: flex-start;
    flex-direction: column;
    gap: 12px;
    padding: 22px;
  }
  .cost-total p {
    margin: 0;
  }
  .breakdown {
    padding: 18px;
  }
}
</style>
