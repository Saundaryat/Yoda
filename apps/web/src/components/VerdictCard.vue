<script setup lang="ts">
import type { ExperimentResults } from '@evals/shared';
import { computed } from 'vue';
import { percent, points, VERDICT } from '../format.js';
import IntervalChart from './IntervalChart.vue';

const props = defineProps<{ results: ExperimentResults; provisional: boolean }>();
const c = computed(() => props.results.comparison);
const verdict = computed(() => VERDICT[c.value.verdict]);

const explanation = computed(() => {
  const {
    passRateA,
    passRateB,
    difference,
    ci,
    practicalMargin,
    pairedTasks,
    plannedTasks,
    minimumDetectable,
  } = c.value;
  const rates = `B passed ${percent(passRateB)} of runs and A ${percent(passRateA)}: a difference of ${points(difference)} (95% interval ${points(ci[0])} to ${points(ci[1])}).`;
  const detectable = minimumDetectable
    ? ` With ${pairedTasks} tasks and this much variation, the experiment reliably detects differences of about ${points(minimumDetectable)} or more.`
    : '';
  switch (c.value.verdict) {
    case 'better':
      return `${rates} The whole interval is above zero, so B is better on these tasks.`;
    case 'worse':
      return `${rates} The whole interval is below zero, so B is worse on these tasks.`;
    case 'no_meaningful_difference':
      return `${rates} The interval sits inside ±${Math.round(practicalMargin * 100)} points, so any difference is too small to matter.`;
    case 'inconclusive':
      return `${rates} The interval includes zero and differences bigger than ${Math.round(practicalMargin * 100)} points, so this experiment can't tell yet.${detectable}`;
    case 'incomplete':
      return `Only ${pairedTasks} of ${plannedTasks} tasks have scored runs under both configurations. Finish or retry the failed runs before reading the result.`;
  }
  return '';
});
</script>

<template>
  <section class="card verdict">
    <div class="row head">
      <span class="badge big" :class="verdict.tone">{{ verdict.label }}</span>
      <span v-if="provisional" class="badge warn">Provisional: runs still open</span>
    </div>
    <p class="explanation">{{ explanation }}</p>
    <IntervalChart
      v-if="c.pairedTasks"
      :estimate="c.difference"
      :ci="c.ci"
      :margin="c.practicalMargin"
    />
    <p class="hint">
      Points are percentage points of pass rate, B minus A. Shaded band: ±{{
        Math.round(c.practicalMargin * 100)
      }}
      points, too small to act on. Tasks B won: {{ c.wins }}, lost: {{ c.losses }}, tied:
      {{ c.pairedTasks - c.wins - c.losses }} (sign test p = {{ c.signTestP.toFixed(3) }}).
    </p>
  </section>
</template>

<style scoped>
.head {
  margin-bottom: 8px;
}
.big {
  font-size: 15px;
  padding: 4px 12px;
}
.explanation {
  font-size: 15px;
  max-width: 760px;
}
</style>
