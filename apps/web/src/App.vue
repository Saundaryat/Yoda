<script setup lang="ts">
import type { HealthStatus } from '@evals/shared';
import { RouterLink, RouterView } from 'vue-router';
import { useResource } from './composables/useResource.js';

const { data: health } = useResource<HealthStatus>('/health');
</script>

<template>
  <header class="topbar">
    <RouterLink to="/" class="brand">Agent Evals</RouterLink>
    <nav>
      <RouterLink to="/">Experiments</RouterLink>
      <RouterLink to="/tasks">Tasks</RouterLink>
      <RouterLink to="/configurations">Configurations</RouterLink>
    </nav>
    <span v-if="health" class="health muted" :title="`Database: ${health.database}`">
      {{ health.hermes ?? 'Hermes not found' }}
    </span>
  </header>
  <main class="page">
    <RouterView />
  </main>
</template>

<style scoped>
.topbar {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 10px 16px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
}
.brand {
  font-weight: 700;
  color: var(--text);
}
nav {
  display: flex;
  gap: 16px;
}
nav a {
  color: var(--muted);
}
nav a.router-link-exact-active,
nav a.router-link-active:not([href='/']) {
  color: var(--text);
  font-weight: 600;
}
.health {
  margin-left: auto;
  font-size: 12px;
}
</style>
