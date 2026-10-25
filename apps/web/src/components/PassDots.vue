<script setup lang="ts">
import { RouterLink } from 'vue-router';
import { useReviewNavigation } from '../composables/useReviewNavigation.js';
const { detailLink } = useReviewNavigation('/');
import type { RunSummary } from '@evals/shared';

defineProps<{
  runs: { runId: string; passed: boolean; score: number }[];
  side: 'a' | 'b';
  summaries?: RunSummary[] | null;
}>();
</script>

<template>
  <span class="dots">
    <RouterLink
      v-for="(run, i) in runs"
      :key="run.runId"
      :to="detailLink(`/runs/${run.runId}`)"
      class="dot"
      :class="run.passed ? 'pass' : 'fail'"
      :title="`Repetition ${summaries?.find((r) => r.id === run.runId)?.repetition ?? i + 1}: ${run.passed ? 'passed' : 'failed'} (score ${run.score})`"
      >{{ run.passed ? '✓' : '✗' }}</RouterLink
    >
    <span v-if="!runs.length" class="muted">—</span>
  </span>
</template>

<style scoped>
.dots {
  display: inline-flex;
  gap: 4px;
}
.dot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  font-size: 12px;
  font-weight: 700;
  text-decoration: none;
}
.dot.pass {
  background: var(--good-soft);
  color: var(--good);
}
.dot.fail {
  background: var(--bad-soft);
  color: var(--bad);
}
</style>
