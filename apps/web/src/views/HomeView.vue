<script setup lang="ts">
import type { HealthStatus } from '@evals/shared';
import { onMounted, ref } from 'vue';
import { api } from '../api.js';

const health = ref<HealthStatus | null>(null);
const error = ref<string | null>(null);

onMounted(async () => {
  try {
    health.value = await api<HealthStatus>('/health');
  } catch (e) {
    error.value = (e as Error).message;
  }
});
</script>

<template>
  <h1>System status</h1>
  <p v-if="error" class="error">API unreachable: {{ error }}</p>
  <dl v-else-if="health" class="facts">
    <dt>Database</dt>
    <dd>{{ health.database }}</dd>
    <dt>Hermes</dt>
    <dd>{{ health.hermes ?? 'not installed' }}</dd>
  </dl>
  <p v-else>Checking…</p>
</template>
