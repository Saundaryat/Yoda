<script setup lang="ts">
import type { CheckResult, ExperimentResults, RunEvent } from '@evals/shared';
import { computed, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { api } from '../api.js';
import Timeline from '../components/Timeline.vue';
import { useResource } from '../composables/useResource.js';

interface RunDetail {
  run: { id: string; passed: boolean | null; score: number | null };
  configuration: { name: string };
  events: RunEvent[];
  checks: CheckResult[];
}

const props = defineProps<{ id: string; taskId: string }>();
const { data: results } = useResource<ExperimentResults>(
  computed(() => `/experiments/${props.id}/results`),
);
const task = computed(() => results.value?.tasks.find((t) => t.taskId === props.taskId));
const repetitions = computed(() => Math.max(task.value?.a.length ?? 0, task.value?.b.length ?? 0));
const repetition = ref(0);
const a = ref<RunDetail | null>(null);
const b = ref<RunDetail | null>(null);

watch(
  [task, repetition],
  async ([t, rep]) => {
    if (!t) return;
    const load = (runId: string | undefined) =>
      runId ? api<RunDetail>(`/runs/${runId}`) : Promise.resolve(null);
    [a.value, b.value] = await Promise.all([load(t.a[rep]?.runId), load(t.b[rep]?.runId)]);
  },
  { immediate: true },
);

const checkRows = computed(() =>
  (a.value?.checks ?? b.value?.checks ?? []).map((check) => ({
    label: check.label,
    critical: check.critical,
    a: a.value?.checks.find((c) => c.checkId === check.checkId),
    b: b.value?.checks.find((c) => c.checkId === check.checkId),
  })),
);
const mark = (c: CheckResult | undefined) => (c ? (c.passed ? '✓' : '✗') : '—');
</script>

<template>
  <template v-if="task">
    <div class="page-head">
      <div>
        <p class="subtitle"><RouterLink :to="`/experiments/${id}`">← Experiment</RouterLink></p>
        <h1>{{ task.title }}</h1>
        <p class="subtitle mono">{{ task.key }} · {{ task.group }}</p>
      </div>
      <div class="row">
        <span class="muted">Repetition</span>
        <button
          v-for="n in repetitions"
          :key="n"
          :class="{ primary: repetition === n - 1 }"
          @click="repetition = n - 1"
        >
          {{ n }}
        </button>
      </div>
    </div>

    <section class="card table-scroll">
      <h2>Checks, side by side</h2>
      <table>
        <thead>
          <tr>
            <th>Check</th>
            <th class="side-a">A · {{ a?.configuration.name }}</th>
            <th class="side-b">B · {{ b?.configuration.name }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in checkRows"
            :key="row.label"
            :class="{ differs: row.a?.passed !== row.b?.passed }"
          >
            <td>{{ row.label }} <span v-if="row.critical" class="badge warn">critical</span></td>
            <td :class="row.a?.passed ? 'ok' : 'bad'">
              {{ mark(row.a) }} <span class="muted">{{ row.a?.detail }}</span>
            </td>
            <td :class="row.b?.passed ? 'ok' : 'bad'">
              {{ mark(row.b) }} <span class="muted">{{ row.b?.detail }}</span>
            </td>
          </tr>
          <tr>
            <td><strong>Result</strong></td>
            <td>
              <strong>{{ a?.run.passed ? 'Passed' : 'Failed' }}</strong> · {{ a?.run.score }}
            </td>
            <td>
              <strong>{{ b?.run.passed ? 'Passed' : 'Failed' }}</strong> · {{ b?.run.score }}
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <div class="grid-2">
      <section class="card">
        <div class="row">
          <h2 class="side-a">A · {{ a?.configuration.name }}</h2>
          <RouterLink v-if="a" :to="`/runs/${a.run.id}`">Open run</RouterLink>
        </div>
        <Timeline v-if="a" :events="a.events" :highlighted="[]" />
      </section>
      <section class="card">
        <div class="row">
          <h2 class="side-b">B · {{ b?.configuration.name }}</h2>
          <RouterLink v-if="b" :to="`/runs/${b.run.id}`">Open run</RouterLink>
        </div>
        <Timeline v-if="b" :events="b.events" :highlighted="[]" />
      </section>
    </div>
  </template>
</template>

<style scoped>
.row h2 {
  margin: 0 auto 0 0;
}
tr.differs td {
  background: var(--warn-soft);
}
td.ok {
  color: var(--good);
}
td.bad {
  color: var(--bad);
}
</style>
