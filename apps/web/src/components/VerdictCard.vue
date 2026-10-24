<script setup lang="ts">
import type { ExperimentResults } from '@evals/shared';
import { computed } from 'vue';
import { percent, points, VERDICT } from '../format.js';
import IntervalChart from './IntervalChart.vue';

const props = defineProps<{ results: ExperimentResults; provisional: boolean }>();
const c = computed(() => props.results.comparison);
const verdict = computed(() => VERDICT[c.value.verdict]);

const headline = computed(() => {
  switch (c.value.verdict) {
    case 'better':
      return 'The candidate performed reliably better on these scenarios.';
    case 'worse':
      return 'The candidate performed reliably worse on these scenarios.';
    case 'no_meaningful_difference':
      return 'The two versions performed about the same.';
    case 'inconclusive':
      if (c.value.pairedTasks < 10) {
        return `The candidate did better in this small test, but ${c.value.pairedTasks} scenarios are not enough to decide.`;
      }
      return 'The candidate did better here, but there is not enough evidence to be confident yet.';
    case 'incomplete':
      return props.provisional
        ? 'Runs are still in progress, so this result can change.'
        : 'Some scenarios are missing results for one or both versions.';
  }
  return '';
});

const nextStep = computed(() => {
  switch (c.value.verdict) {
    case 'better':
      return 'The evidence supports moving forward, after reviewing any critical regressions.';
    case 'worse':
      return 'Keep the baseline and review the scenarios where the candidate regressed.';
    case 'no_meaningful_difference':
      return 'Choose based on cost, speed, or maintainability instead of pass rate.';
    case 'inconclusive':
      if (c.value.pairedTasks < 10) {
        const remaining = 10 - c.value.pairedTasks;
        return `Add at least ${remaining} more ${remaining === 1 ? 'scenario' : 'scenarios'} so both versions are tested on the minimum of 10.`;
      }
      return 'Add more scenarios or repetitions before deciding whether to ship the candidate.';
    case 'incomplete':
      return props.provisional
        ? 'Wait for the remaining runs before making a decision.'
        : 'Retry technical failures before interpreting the result.';
  }
  return '';
});
</script>

<template>
  <section class="card verdict">
    <div class="verdict-label">
      <span>Decision</span>
      <span class="badge big" :class="verdict.tone">{{ verdict.label }}</span>
      <span v-if="provisional" class="badge warn">Runs still open</span>
    </div>
    <h2>{{ headline }}</h2>
    <p class="rate-summary">
      <strong>B passed {{ percent(c.passRateB) }}</strong>
      <span>compared with A at {{ percent(c.passRateA) }}</span>
      <span class="change">{{ points(c.difference) }}</span>
    </p>
    <div class="next-step">
      <strong>Recommended next step</strong><span>{{ nextStep }}</span>
    </div>

    <details v-if="c.pairedTasks" class="statistical-detail">
      <summary>View statistical detail</summary>
      <IntervalChart :estimate="c.difference" :ci="c.ci" :margin="c.practicalMargin" />
      <p class="hint">
        The 95% range is {{ points(c.ci[0]) }} to {{ points(c.ci[1]) }}. B won
        {{ c.wins }} scenarios, lost {{ c.losses }}, and tied
        {{ c.pairedTasks - c.wins - c.losses }}. Sign-test p = {{ c.signTestP.toFixed(3) }}.
      </p>
    </details>
  </section>
</template>

<style scoped>
.verdict {
  padding: 28px;
  border-color: #cfcfcf;
}
.verdict-label {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 14px;
}
.verdict-label > span:first-child {
  margin-right: 4px;
  color: var(--muted);
  font-size: 9.5px;
  font-weight: 750;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.big {
  font-size: 11px;
  padding: 4px 9px;
}
.verdict h2 {
  max-width: 760px;
  margin-bottom: 16px;
  font-size: 22px;
  line-height: 1.35;
}
.rate-summary {
  display: flex;
  gap: 8px;
  align-items: baseline;
  margin-bottom: 20px;
  color: var(--muted);
  font-size: 12px;
}
.rate-summary strong {
  color: var(--text);
  font-size: 16px;
}
.change {
  margin-left: 5px;
  padding: 2px 7px;
  color: var(--text);
  background: var(--surface-2);
  border-radius: 999px;
  font-weight: 700;
}
.next-step {
  display: grid;
  grid-template-columns: 150px 1fr;
  gap: 16px;
  max-width: 820px;
  padding: 14px 16px;
  background: #f7f7f7;
  border-radius: 7px;
  font-size: 11.5px;
}
.next-step span {
  color: #555;
}
.statistical-detail {
  margin-top: 18px;
  color: var(--muted);
  font-size: 11px;
}
.statistical-detail summary {
  width: fit-content;
  color: var(--text);
  font-weight: 650;
}
.statistical-detail .hint {
  margin-bottom: 0;
}
@media (max-width: 640px) {
  .rate-summary {
    align-items: flex-start;
    flex-direction: column;
  }
  .change {
    margin-left: 0;
  }
  .next-step {
    grid-template-columns: 1fr;
    gap: 3px;
  }
}
</style>
