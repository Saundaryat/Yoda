<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { useResource } from '../composables/useResource.js';
import { groupName, taskName } from '../names.js';

interface TaskItem {
  id: string;
  key: string;
  title: string;
  split: 'dev' | 'eval';
  group: string;
  family: string;
  sessions: number;
  checks: number;
}

const { data: tasks, error } = useResource<TaskItem[]>('/tasks');
const split = ref<'all' | 'dev' | 'eval'>('eval');
const shown = computed(() =>
  (tasks.value ?? []).filter((t) => split.value === 'all' || t.split === split.value),
);
const categories = computed(() =>
  ['policy', 'control', 'memory'].map((group) => ({
    group,
    count: shown.value.filter((t) => t.group === group).length,
  })),
);
</script>

<template>
  <div class="page-head">
    <div>
      <p class="page-kicker">Scenario library</p>
      <h1>Scenarios</h1>
      <p class="subtitle">
        Realistic customer situations with clear pass/fail checks. Open a scenario to inspect its
        customer script, starting CRM data and expected behavior.
      </p>
    </div>
  </div>
  <section v-if="tasks" class="collection-summary" aria-label="Scenario coverage">
    <div v-for="c in categories" :key="c.group">
      <span>{{ groupName(c.group) }}</span
      ><strong>{{ c.count }}</strong>
    </div>
  </section>
  <div class="collection-toolbar">
    <p>
      {{ shown.length }} scenarios
      <small
        >·
        {{
          split === 'eval'
            ? 'Frozen evaluation suite'
            : split === 'dev'
              ? 'Development checks'
              : 'All saved scenarios'
        }}</small
      >
    </p>
    <div class="segmented-filter" role="group" aria-label="Scenario suite">
      <button
        v-for="s in ['all', 'dev', 'eval'] as const"
        :key="s"
        :class="{ primary: split === s }"
        :aria-pressed="split === s"
        @click="split = s"
      >
        {{
          s === 'eval'
            ? 'Evaluation scenarios'
            : s === 'dev'
              ? 'Development scenarios'
              : 'All scenarios'
        }}
      </button>
    </div>
  </div>
  <p v-if="error" class="error">{{ error }}</p>
  <p v-else-if="!tasks" class="muted" role="status">Loading scenarios…</p>
  <div v-else-if="!shown.length" class="card empty">
    No scenarios in this suite. Choose another suite above.
  </div>
  <div v-else class="card table-scroll">
    <table>
      <thead>
        <tr>
          <th>Scenario</th>
          <th>Group</th>
          <th v-if="split === 'all'">Suite</th>
          <th class="num">Sessions</th>
          <th class="num">Checks</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="t in shown" :key="t.id">
          <td>
            <RouterLink :to="`/tasks/${t.id}`">{{ taskName(t) }}</RouterLink>
          </td>
          <td class="group-cell">
            <span
              class="badge"
              :class="t.group === 'policy' ? 'info' : t.group === 'memory' ? 'warn' : ''"
              >{{ groupName(t.group) }}</span
            >
          </td>
          <td v-if="split === 'all'">{{ t.split === 'eval' ? 'Evaluation' : 'Development' }}</td>
          <td class="num">{{ t.sessions }}</td>
          <td class="num">{{ t.checks }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.group-cell {
  width: 26%;
}
.group-cell .badge {
  overflow-wrap: normal;
  word-break: normal;
  text-transform: none;
}
</style>
