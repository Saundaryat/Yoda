<script setup lang="ts">
import type { ExperimentStatus, RunStatus } from '@evals/shared';
import { computed } from 'vue';

const props = defineProps<{ status: ExperimentStatus | RunStatus }>();
const TONE: Record<string, string> = {
  draft: '',
  queued: '',
  running: 'info',
  finished: 'good',
  scored: 'good',
  error: 'bad',
  cancelled: 'warn',
};
const tone = computed(() => TONE[props.status] ?? '');
</script>

<template>
  <span class="badge" :class="tone">{{ status }}</span>
</template>
