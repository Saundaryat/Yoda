<script setup lang="ts">
import { MIN_TASKS_FOR_VERDICT, type ExperimentResults } from '@evals/shared';
import { computed } from 'vue';
import { percent, points, VERDICT } from '../format.js';
import IntervalChart from './IntervalChart.vue';

const props = defineProps<{ results: ExperimentResults; provisional: boolean }>();
const c = computed(() => props.results.comparison);
const verdict = computed(() => VERDICT[c.value.verdict]);

const observedResult = computed(() => {
  if (c.value.difference > 0) return 'The candidate scored higher in this test';
  if (c.value.difference < 0) return 'The candidate scored lower in this test';
  return 'The two versions scored the same in this test';
});

const headline = computed(() => {
  switch (c.value.verdict) {
    case 'better':
      return 'The candidate performed reliably better on these scenarios.';
    case 'worse':
      return 'The candidate performed reliably worse on these scenarios.';
    case 'no_meaningful_difference':
      return 'The two versions performed about the same.';
    case 'inconclusive':
      if (c.value.pairedTasks < MIN_TASKS_FOR_VERDICT) {
        return c.value.difference === 0
          ? 'Observed tie. More coverage needed.'
          : 'Observed difference. More coverage needed.';
      }
      return `${observedResult.value}, but the evidence is not conclusive.`;
    case 'incomplete':
      return (
        c.value.incompleteReason ?? 'Some planned repetitions or required judgments are missing.'
      );
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
      if (c.value.pairedTasks < MIN_TASKS_FOR_VERDICT) {
        if (c.value.plannedTasks >= MIN_TASKS_FOR_VERDICT) {
          return `Retry the missing runs so at least ${MIN_TASKS_FOR_VERDICT} scenarios have results for both versions.`;
        }
        return `${c.value.pairedTasks} paired scenarios provide an exploratory result. Broader, independent scenarios and repeated runs are needed before choosing a version.`;
      }
      return 'Add more scenarios or repetitions before deciding whether to ship the candidate.';
    case 'incomplete':
      return props.provisional
        ? 'Wait for the remaining runs before making a decision.'
        : 'Complete missing repetitions and required grading before interpreting the result.';
  }
  return '';
});
</script>

<template>
  <section class="card verdict">
    <div class="verdict-label">
      <span>Result</span>
      <span class="badge big" :class="verdict.tone">{{ verdict.label }}</span>
      <span v-if="provisional" class="badge warn">Runs still open</span>
    </div>
    <h2>{{ headline }}</h2>
    <p v-if="c.pairedTasks" class="rate-summary">
      <strong>B passed {{ percent(c.passRateB) }}</strong>
      <span>compared with A at {{ percent(c.passRateA) }}</span>
      <span class="change">{{ points(c.difference) }}</span>
    </p>
    <details v-if="c.pairedTasks" class="statistical-detail">
      <summary>Confidence &amp; methodology</summary>
      <p>{{ nextStep }}</p>
      <p class="hint">
        An inconclusive comparison means the evidence does not establish a winner. It is not a
        scenario-quality score. More tasks do not guarantee a winner.
      </p>
      <IntervalChart :estimate="c.difference" :ci="c.ci" :margin="c.practicalMargin" />
      <p class="hint">
        A better or worse verdict requires the entire 95% range to clear the practical margin of ±{{
          points(c.practicalMargin).replace('+', '')
        }}. Comparison {{ c.comparisonVersion ?? 'historical' }}. The 95% range is
        {{ points(c.ci[0]) }} to {{ points(c.ci[1]) }}. B won {{ c.wins }} scenarios, lost
        {{ c.losses }}, and tied {{ c.pairedTasks - c.wins - c.losses }}. Sign-test p =
        {{ c.signTestP.toFixed(3) }}.
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
