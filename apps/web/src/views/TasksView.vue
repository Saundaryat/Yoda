<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { useResource } from '../composables/useResource.js';

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
const split = ref<'all' | 'dev' | 'eval'>('all');
const shown = computed(() =>
  (tasks.value ?? []).filter((t) => split.value === 'all' || t.split === split.value),
);
</script>

<template>
  <div class="page-head">
    <div>
      <h1>Tasks</h1>
      <p class="subtitle">
        Each task is a YAML file in <span class="mono">suites/</span>: a CRM starting state, a
        scripted lead, and the checks that decide pass or fail.
      </p>
    </div>
    <div class="row">
      <button
        v-for="s in ['all', 'dev', 'eval'] as const"
        :key="s"
        :class="{ primary: split === s }"
        @click="split = s"
      >
        {{ s }}
      </button>
    </div>
  </div>
  <p v-if="error" class="error">{{ error }}</p>
  <div v-else class="card table-scroll">
    <table>
      <thead>
        <tr>
          <th>Task</th>
          <th>Group</th>
          <th>Family</th>
          <th>Split</th>
          <th class="num">Sessions</th>
          <th class="num">Checks</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="t in shown" :key="t.id">
          <td>
            <RouterLink :to="`/tasks/${t.id}`">{{ t.title }}</RouterLink>
            <div class="mono muted">{{ t.key }}</div>
          </td>
          <td>
            <span
              class="badge"
              :class="t.group === 'policy' ? 'info' : t.group === 'memory' ? 'warn' : ''"
              >{{ t.group }}</span
            >
          </td>
          <td class="mono">{{ t.family }}</td>
          <td>{{ t.split }}</td>
          <td class="num">{{ t.sessions }}</td>
          <td class="num">{{ t.checks }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
