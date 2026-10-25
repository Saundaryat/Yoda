<script setup lang="ts">
import type {
  CheckResult,
  ExperimentResults,
  ExperimentSummary,
  RunSummary,
  RunStatus,
  RunEvent,
  JudgeReport,
} from '@evals/shared';
import { computed, nextTick, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { api } from '../api.js';
import Timeline from '../components/Timeline.vue';
import { useReviewNavigation } from '../composables/useReviewNavigation.js';
import { useResource } from '../composables/useResource.js';
import { configurationName, groupName, taskName } from '../names.js';

interface RunDetail {
  run: {
    id: string;
    status: RunStatus;
    passed: boolean | null;
    score: number | null;
    judge: JudgeReport | null;
  };
  configuration: { id: string; name: string };
  events: RunEvent[];
  checks: CheckResult[];
}

const props = defineProps<{ id: string; taskId: string }>();
const route = useRoute();
const { data: experiment, error: experimentError } = useResource<ExperimentSummary>(
  computed(() => `/experiments/${props.id}`),
);
const { data: runSummaries, error: runsError } = useResource<RunSummary[]>(
  computed(() => `/experiments/${props.id}/runs`),
);
const { data: results, error: resultsError } = useResource<ExperimentResults>(
  computed(() => `/experiments/${props.id}/results`),
);
const task = computed(() => results.value?.tasks.find((t) => t.taskId === props.taskId));
const repetitions = computed(() => experiment.value?.repetitions ?? 0);
const repetition = computed({
  get: () => {
    const value = Number(route.query.repetition);
    return Number.isInteger(value) && value >= 1 && value <= 10 ? value : 1;
  },
  set: (value: number) => {
    void router.replace({ query: { ...route.query, repetition: value } });
  },
});
const router = useRouter();
const comparisonReturnTo = computed(
  () =>
    router.resolve({ path: route.path, query: { ...route.query, repetition: repetition.value } })
      .fullPath,
);
const a = ref<RunDetail | null>(null);
const b = ref<RunDetail | null>(null);
const loading = ref(true);
const loadError = ref<string | null>(null);
const highlightA = ref<number[]>([]);
const highlightB = ref<number[]>([]);
const onlyDifferences = ref(false);
async function focusEvidence(side: 'a' | 'b', check: CheckResult) {
  const seqs = check.evidence.flatMap((e) => (e.eventSeq ? [e.eventSeq] : []));
  if (side === 'a') highlightA.value = seqs;
  else highlightB.value = seqs;
  await nextTick();
  document
    .getElementById(`${side}-event-${seqs[0]}`)
    ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
let loadGeneration = 0;

watch(
  [task, repetition, runSummaries, experiment],
  async ([t, rep, summaries, e]) => {
    if (!t || !summaries || !e) return;
    if (rep > e.repetitions) {
      repetition.value = 1;
      return;
    }
    const generation = ++loadGeneration;
    loading.value = true;
    loadError.value = null;
    highlightA.value = [];
    highlightB.value = [];
    a.value = null;
    b.value = null;
    const load = (runId: string | undefined) =>
      runId ? api<RunDetail>(`/runs/${runId}`) : Promise.resolve(null);
    try {
      const runId = (configId: string) =>
        summaries.find(
          (r) => r.taskId === props.taskId && r.configId === configId && r.repetition === rep,
        )?.id;
      const [nextA, nextB] = await Promise.all([
        load(runId(e.baselineConfigId)),
        load(runId(e.candidateConfigId)),
      ]);
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
    informational: check.informational,
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
const visibleChecks = computed(() =>
  checkRows.value.filter((row) => !onlyDifferences.value || checksDiffer(row.a, row.b)),
);
const resultLabel = (detail: RunDetail | null) => {
  if (!detail) return 'No run recorded';
  if (detail.run.passed === null)
    return {
      queued: 'Queued',
      running: 'Running',
      error: 'Technical failure',
      cancelled: 'Cancelled',
      scored: 'Needs grading',
    }[detail.run.status];
  return detail.run.passed ? 'Passed' : 'Failed';
};
const { backTo, backLabel, detailLink, goBack } = useReviewNavigation(
  computed(() => `/experiments/${props.id}?section=scenarios`),
);
</script>

<template>
  <p v-if="resultsError || runsError || experimentError" class="error" role="alert">
    Could not load comparison: {{ resultsError || runsError || experimentError }}
  </p>
  <p v-else-if="!results" class="muted" role="status">Loading comparison…</p>
  <div v-else-if="!task" class="card empty">
    <h1>Scenario not in this experiment</h1>
    <a :href="backTo" @click="goBack">{{ backLabel }}</a>
  </div>
  <template v-else-if="task">
    <div class="page-head">
      <div>
        <p class="subtitle">
          <a :href="backTo" @click="goBack">← {{ backLabel }}</a>
        </p>
        <p class="page-kicker">Side-by-side evidence</p>
        <h1>{{ taskName(task) }}</h1>
        <p class="subtitle">
          {{ groupName(task.group) }} · Compare the same scenario and repetition.
        </p>
      </div>
      <div class="row repetition-picker">
        <span class="muted">Repetition</span>
        <button
          v-for="n in repetitions"
          :key="n"
          :class="{ primary: repetition === n }"
          :aria-pressed="repetition === n"
          @click="repetition = n"
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

    <section v-else class="card table-scroll comparison-checks">
      <h2>Checks, side by side</h2>
      <div class="comparison-toolbar">
        <p>Expand a result to read the decision and jump to the exact evidence.</p>
        <label><input v-model="onlyDifferences" type="checkbox" /> Only different results</label>
      </div>
      <table>
        <thead>
          <tr>
            <th>Check</th>
            <th class="side-a">
              A ·
              <RouterLink v-if="a" :to="detailLink(`/configurations/${a.configuration.id}`)">{{
                configurationName(a.configuration)
              }}</RouterLink
              ><span v-else>No run recorded</span>
            </th>
            <th class="side-b">
              B ·
              <RouterLink v-if="b" :to="detailLink(`/configurations/${b.configuration.id}`)">{{
                configurationName(b.configuration)
              }}</RouterLink
              ><span v-else>No run recorded</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in visibleChecks"
            :key="row.label"
            :class="{ differs: checksDiffer(row.a, row.b) }"
          >
            <td>
              {{ row.label }} <span v-if="row.critical" class="badge warn">critical</span
              ><span v-if="row.informational" class="badge">reply quality · not scored</span>
            </td>
            <td :class="checkTone(row.a)">
              <details v-if="row.a">
                <summary>
                  {{ mark(row.a) }}
                  {{ row.a.skipped ? 'Not judged' : row.a.passed ? 'Passed' : 'Failed' }}
                </summary>
                <span class="muted">{{ row.a.detail }}</span>
                <button
                  v-if="row.a.evidence.some((e) => e.eventSeq)"
                  class="evidence-jump"
                  @click="focusEvidence('a', row.a)"
                >
                  Show A evidence
                </button>
              </details>
              <span v-else>—</span>
            </td>
            <td :class="checkTone(row.b)">
              <details v-if="row.b">
                <summary>
                  {{ mark(row.b) }}
                  {{ row.b.skipped ? 'Not judged' : row.b.passed ? 'Passed' : 'Failed' }}
                </summary>
                <span class="muted">{{ row.b.detail }}</span>
                <button
                  v-if="row.b.evidence.some((e) => e.eventSeq)"
                  class="evidence-jump"
                  @click="focusEvidence('b', row.b)"
                >
                  Show B evidence
                </button>
              </details>
              <span v-else>—</span>
            </td>
          </tr>
          <tr v-if="onlyDifferences && !visibleChecks.length">
            <td colspan="3">No differing check results in this repetition.</td>
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

    <div v-if="!loading && !loadError" class="grid-2 comparison-conversations">
      <section class="card conversation-panel" aria-label="A conversation">
        <div class="row">
          <h2 class="side-a">A · {{ a ? configurationName(a.configuration) : 'No scored run' }}</h2>
          <RouterLink
            v-if="a"
            :to="{ path: `/runs/${a.run.id}`, query: { returnTo: comparisonReturnTo } }"
            >Open run</RouterLink
          >
        </div>
        <p class="panel-caption">Starting version · {{ resultLabel(a) }}</p>
        <Timeline
          v-if="a"
          :events="a.events"
          :highlighted="highlightA"
          id-prefix="a-event"
          :judgments="a.run.judge?.turns"
          :lead-labels="a.run.judge?.leadTurns"
        />
      </section>
      <section class="card conversation-panel" aria-label="B conversation">
        <div class="row">
          <h2 class="side-b">B · {{ b ? configurationName(b.configuration) : 'No scored run' }}</h2>
          <RouterLink
            v-if="b"
            :to="{ path: `/runs/${b.run.id}`, query: { returnTo: comparisonReturnTo } }"
            >Open run</RouterLink
          >
        </div>
        <p class="panel-caption">Proposed version · {{ resultLabel(b) }}</p>
        <Timeline
          v-if="b"
          :events="b.events"
          :highlighted="highlightB"
          id-prefix="b-event"
          :judgments="b.run.judge?.turns"
          :lead-labels="b.run.judge?.leadTurns"
        />
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
