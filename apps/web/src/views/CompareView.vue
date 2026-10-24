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
const loading = ref(true);
const loadError = ref<string | null>(null);
let loadGeneration = 0;

watch(
  [task, repetition],
  async ([t, rep]) => {
    if (!t) return;
    const generation = ++loadGeneration;
    loading.value = true;
    loadError.value = null;
    a.value = null;
    b.value = null;
    const load = (runId: string | undefined) =>
      runId ? api<RunDetail>(`/runs/${runId}`) : Promise.resolve(null);
    try {
      const [nextA, nextB] = await Promise.all([load(t.a[rep]?.runId), load(t.b[rep]?.runId)]);
      if (generation !== loadGeneration) return;
      a.value = nextA;
      b.value = nextB;
    } catch (error) {
      if (generation !== loadGeneration) return;
      loadError.value = (error as Error).message;
    } finally {
      if (generation === loadGeneration) loading.value = false;
    }
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
const mark = (check: CheckResult | undefined) =>
  !check || check.skipped ? '—' : check.passed ? '✓' : '✗';
const checkTone = (check: CheckResult | undefined) =>
  !check || check.skipped ? '' : check.passed ? 'ok' : 'bad';
const checksDiffer = (left: CheckResult | undefined, right: CheckResult | undefined) => {
  if (!left || !right) return Boolean(left || right);
  if (left.skipped || right.skipped) return left.skipped !== right.skipped;
  return left.passed !== right.passed;
};
const resultLabel = (detail: RunDetail | null) => {
  if (!detail) return 'No scored run';
  if (detail.run.passed === null) return 'Not scored';
  return detail.run.passed ? 'Passed' : 'Failed';
};
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

    <section v-if="loading" class="card loading-card" aria-live="polite">
      <span class="loading-line" />
      <span class="loading-line short" />
      Loading this A/B comparison…
    </section>
    <p v-else-if="loadError" class="card error">Could not load comparison: {{ loadError }}</p>

    <section v-else class="card table-scroll">
      <h2>Checks, side by side</h2>
      <table>
        <thead>
          <tr>
            <th>Check</th>
            <th class="side-a">A · {{ a?.configuration.name ?? 'No scored run' }}</th>
            <th class="side-b">B · {{ b?.configuration.name ?? 'No scored run' }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in checkRows"
            :key="row.label"
            :class="{ differs: checksDiffer(row.a, row.b) }"
          >
            <td>{{ row.label }} <span v-if="row.critical" class="badge warn">critical</span></td>
            <td :class="checkTone(row.a)">
              {{ mark(row.a) }} <span class="muted">{{ row.a?.detail }}</span>
            </td>
            <td :class="checkTone(row.b)">
              {{ mark(row.b) }} <span class="muted">{{ row.b?.detail }}</span>
            </td>
          </tr>
          <tr>
            <td><strong>Result</strong></td>
            <td>
              <strong>{{ resultLabel(a) }}</strong>
              <template v-if="a?.run.score !== null && a?.run.score !== undefined">
                · {{ a.run.score }}
              </template>
            </td>
            <td>
              <strong>{{ resultLabel(b) }}</strong>
              <template v-if="b?.run.score !== null && b?.run.score !== undefined">
                · {{ b.run.score }}
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <div v-if="!loading && !loadError" class="grid-2">
      <section class="card">
        <div class="row">
          <h2 class="side-a">A · {{ a?.configuration.name ?? 'No scored run' }}</h2>
          <RouterLink v-if="a" :to="`/runs/${a.run.id}`">Open run</RouterLink>
        </div>
        <Timeline v-if="a" :events="a.events" :highlighted="[]" />
      </section>
      <section class="card">
        <div class="row">
          <h2 class="side-b">B · {{ b?.configuration.name ?? 'No scored run' }}</h2>
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
.loading-card {
  display: grid;
  gap: 8px;
  color: var(--muted);
  font-size: 12px;
}
.loading-line {
  display: block;
  width: 58%;
  height: 10px;
  background: var(--surface-2);
  border-radius: 999px;
}
.loading-line.short {
  width: 36%;
}
td.ok {
  color: var(--good);
}
td.bad {
  color: var(--bad);
}
</style>
