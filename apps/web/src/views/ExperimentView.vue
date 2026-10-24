<script setup lang="ts">
import type {
  Configuration,
  ExperimentResults,
  ExperimentSummary,
  RunSummary,
} from '@evals/shared';
import { computed, ref, toRef } from 'vue';
import { RouterLink } from 'vue-router';
import { api } from '../api.js';
import PassDots from '../components/PassDots.vue';
import StatusBadge from '../components/StatusBadge.vue';
import VerdictCard from '../components/VerdictCard.vue';
import { useExperimentEvents } from '../composables/useExperimentEvents.js';
import { useResource } from '../composables/useResource.js';
import { dateTime, money, percent, points, seconds } from '../format.js';

const props = defineProps<{ id: string }>();
const id = toRef(props, 'id');

const experiment = useResource<ExperimentSummary>(computed(() => `/experiments/${id.value}`));
const results = useResource<ExperimentResults>(computed(() => `/experiments/${id.value}/results`));
const runs = useResource<RunSummary[]>(computed(() => `/experiments/${id.value}/runs`));
const { data: configurations } = useResource<Configuration[]>('/configurations');

let pending: ReturnType<typeof setTimeout> | undefined;
useExperimentEvents(id, () => {
  clearTimeout(pending);
  pending = setTimeout(() => {
    void experiment.reload();
    void results.reload();
    void runs.reload();
  }, 400);
});

const e = computed(() => experiment.data.value);
const r = computed(() => results.data.value);
const config = (configId: string | undefined) =>
  configurations.value?.find((c) => c.id === configId);
const baseline = computed(() => config(e.value?.baselineConfigId));
const candidate = computed(() => config(e.value?.candidateConfigId));

const total = computed(() =>
  e.value ? Object.values(e.value.counts).reduce((s, n) => s + n, 0) : 0,
);
const done = computed(() =>
  e.value ? e.value.counts.scored + e.value.counts.error + e.value.counts.cancelled : 0,
);
const errors = computed(() => (runs.data.value ?? []).filter((run) => run.status === 'error'));
const errorKinds = computed(() => {
  const counts = new Map<string, number>();
  for (const run of errors.value)
    counts.set(run.errorKind ?? 'unknown', (counts.get(run.errorKind ?? 'unknown') ?? 0) + 1);
  return [...counts.entries()];
});

const busy = ref(false);
const actionError = ref<string | null>(null);
async function act(action: 'start' | 'cancel' | 'retry-errors') {
  busy.value = true;
  actionError.value = null;
  try {
    await api(`/experiments/${id.value}/${action}`, { method: 'POST' });
    await Promise.all([experiment.reload(), results.reload(), runs.reload()]);
  } catch (error) {
    actionError.value = (error as Error).message;
  } finally {
    busy.value = false;
  }
}

const metricRows = computed(() => {
  if (!r.value) return [];
  const m = r.value.metrics;
  return [
    {
      label: 'Pass rate (mean over tasks)',
      a: percent(r.value.comparison.passRateA),
      b: percent(r.value.comparison.passRateB),
      diff: points(r.value.comparison.difference),
      ci: r.value.comparison.ci.map((x) => points(x)).join(' to '),
    },
    {
      label: 'Tasks passed on every run',
      a: percent(r.value.allRunsPass.a),
      b: percent(r.value.allRunsPass.b),
      diff: '',
      ci: '',
    },
    {
      label: 'Cost per run',
      a: money(m.costUsd.a),
      b: money(m.costUsd.b),
      diff: m.costUsd.difference === null ? '—' : money(m.costUsd.difference),
      ci: m.costUsd.ci?.map((x) => money(x)).join(' to ') ?? '',
    },
    {
      label: 'Time per run',
      a: seconds(m.durationMs.a),
      b: seconds(m.durationMs.b),
      diff: seconds(m.durationMs.difference),
      ci: m.durationMs.ci?.map((x) => seconds(x)).join(' to ') ?? '',
    },
    {
      label: 'Tokens per run',
      a: m.totalTokens.a?.toFixed(0) ?? '—',
      b: m.totalTokens.b?.toFixed(0) ?? '—',
      diff: m.totalTokens.difference?.toFixed(0) ?? '—',
      ci: m.totalTokens.ci?.map((x) => x.toFixed(0)).join(' to ') ?? '',
    },
    {
      label: 'Lead fallbacks per run',
      a: m.leadFallbacks.a?.toFixed(2) ?? '—',
      b: m.leadFallbacks.b?.toFixed(2) ?? '—',
      diff: m.leadFallbacks.difference?.toFixed(2) ?? '—',
      ci: '',
    },
    {
      label: 'Replies passing the judge (audience, format, grounding)',
      a: percent(m.replyQuality.a),
      b: percent(m.replyQuality.b),
      diff: points(m.replyQuality.difference),
      ci: m.replyQuality.ci?.map((x) => points(x)).join(' to ') ?? '',
    },
    {
      label: 'Rejected CRM calls per run',
      a: m.rejectedToolCalls.a?.toFixed(2) ?? '—',
      b: m.rejectedToolCalls.b?.toFixed(2) ?? '—',
      diff: m.rejectedToolCalls.difference?.toFixed(2) ?? '—',
      ci: m.rejectedToolCalls.ci?.map((x) => x.toFixed(2)).join(' to ') ?? '',
    },
  ];
});
</script>

<template>
  <p v-if="experiment.error.value" class="error">{{ experiment.error.value }}</p>
  <template v-else-if="e">
    <div class="page-head">
      <div>
        <div class="row">
          <h1>{{ e.name }}</h1>
          <StatusBadge :status="e.status" />
        </div>
        <p class="subtitle">
          <span class="side-a">A: {{ baseline?.name ?? '…' }}</span> vs
          <span class="side-b">B: {{ candidate?.name ?? '…' }}</span> · {{ e.taskIds.length }} tasks
          × {{ e.repetitions }} repetitions · lead:
          {{ e.leadMode === 'llm' ? 'LLM (Claude)' : 'scripted' }} · created
          {{ dateTime(e.createdAt) }}
        </p>
      </div>
      <div class="row">
        <button v-if="e.status === 'draft'" class="primary" :disabled="busy" @click="act('start')">
          Run {{ e.taskIds.length * e.repetitions * 2 }} scenarios
        </button>
        <button
          v-if="e.status === 'running'"
          class="danger"
          :disabled="busy"
          @click="act('cancel')"
        >
          Cancel
        </button>
        <button
          v-if="e.counts.error > 0 && e.status !== 'running'"
          :disabled="busy"
          @click="act('retry-errors')"
        >
          Retry {{ e.counts.error }} failed runs
        </button>
      </div>
    </div>
    <p v-if="actionError" class="error">{{ actionError }}</p>

    <div v-if="e.hypothesis" class="card hypothesis">
      <strong>Hypothesis, written before running:</strong> {{ e.hypothesis }}
    </div>

    <div v-if="e.status === 'draft'" class="card">
      This experiment hasn't started. Running it makes
      {{ e.taskIds.length * e.repetitions * 2 }} real agent conversations with your provider.
    </div>

    <div v-if="total" class="card progress-card">
      <div class="row">
        <strong>{{ done }} / {{ total }} runs finished</strong>
        <span class="muted">
          {{ e.counts.scored }} scored · {{ e.counts.running }} running ·
          {{ e.counts.queued }} queued · {{ e.counts.error }} failed ·
          {{ e.counts.cancelled }} cancelled · spend {{ money(e.costUsd) }}
        </span>
      </div>
      <div class="bar">
        <span class="scored" :style="{ width: `${(e.counts.scored / total) * 100}%` }" />
        <span class="error" :style="{ width: `${(e.counts.error / total) * 100}%` }" />
        <span class="running" :style="{ width: `${(e.counts.running / total) * 100}%` }" />
      </div>
      <p v-if="errorKinds.length" class="hint">
        Failed runs are infrastructure problems, not agent failures, and are left out of the
        comparison:
        <span v-for="[kind, n] in errorKinds" :key="kind" class="badge bad"
          >{{ kind }} × {{ n }}</span
        >
        <span v-if="errors[0]?.errorDetail" class="mono">
          — {{ errors[0].errorDetail.slice(0, 160) }}</span
        >
      </p>
    </div>

    <template v-if="r && r.coverage.scoredRuns > 0">
      <VerdictCard :results="r" :provisional="r.coverage.openRuns > 0" />

      <div class="grid-2">
        <section class="card">
          <h2>Where the difference comes from</h2>
          <table>
            <thead>
              <tr>
                <th>Task group</th>
                <th class="num">Tasks</th>
                <th class="num">A</th>
                <th class="num">B</th>
                <th class="num">B − A</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="g in r.groups" :key="g.group">
                <td class="cap">{{ g.group }}</td>
                <td class="num">{{ g.tasks }}</td>
                <td class="num">{{ percent(g.passRateA) }}</td>
                <td class="num">{{ percent(g.passRateB) }}</td>
                <td class="num">
                  <strong>{{ points(g.difference) }}</strong>
                  <div class="hint">{{ g.ci.map((x) => points(x)).join(' to ') }}</div>
                </td>
              </tr>
            </tbody>
          </table>
          <template v-if="r.hermesToolUse.length">
            <h3 class="spaced">Hermes tools used (share of runs)</h3>
            <table>
              <tbody>
                <tr v-for="t in r.hermesToolUse" :key="t.tool">
                  <td class="mono">{{ t.tool }}</td>
                  <td class="num"><span class="side-a">A</span> {{ percent(t.a) }}</td>
                  <td class="num"><span class="side-b">B</span> {{ percent(t.b) }}</td>
                </tr>
              </tbody>
            </table>
          </template>
        </section>

        <section class="card">
          <h2>Checks that changed</h2>
          <p v-if="!r.checkFlips.length" class="muted">
            Every check passed equally often under A and B.
          </p>
          <table v-else>
            <thead>
              <tr>
                <th>Task · check</th>
                <th class="num">A</th>
                <th class="num">B</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="f in r.checkFlips.slice(0, 12)" :key="`${f.taskId}/${f.checkId}`">
                <td>
                  <RouterLink :to="`/experiments/${e.id}/tasks/${f.taskId}`">{{
                    f.taskKey
                  }}</RouterLink>
                  <div>
                    {{ f.label }} <span v-if="f.critical" class="badge warn">critical</span>
                  </div>
                </td>
                <td class="num">{{ percent(f.passRateA) }}</td>
                <td class="num">{{ percent(f.passRateB) }}</td>
              </tr>
            </tbody>
          </table>
          <div v-if="r.criticalRegressions.length" class="regressions">
            <strong class="error">Critical checks B broke:</strong>
            <ul>
              <li v-for="f in r.criticalRegressions" :key="`${f.taskId}/${f.checkId}`">
                {{ f.taskKey }}: {{ f.label }} (A {{ percent(f.passRateA) }}, B
                {{ percent(f.passRateB) }})
              </li>
            </ul>
          </div>
        </section>
      </div>

      <section class="card table-scroll">
        <h2>Metrics</h2>
        <table>
          <thead>
            <tr>
              <th></th>
              <th class="num side-a">A</th>
              <th class="num side-b">B</th>
              <th class="num">B − A</th>
              <th class="num">95% interval</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in metricRows" :key="row.label">
              <td>{{ row.label }}</td>
              <td class="num">{{ row.a }}</td>
              <td class="num">{{ row.b }}</td>
              <td class="num">{{ row.diff }}</td>
              <td class="num muted">{{ row.ci }}</td>
            </tr>
          </tbody>
        </table>
        <p class="hint">
          Coverage: {{ r.coverage.scoredRuns }} of {{ r.coverage.plannedRuns }} planned runs scored
          ({{ r.comparison.pairedTasks }}/{{ r.comparison.plannedTasks }} tasks have both sides).
          Costs are Hermes's estimates from list prices.
        </p>
      </section>

      <section class="card table-scroll">
        <h2>Every task</h2>
        <p class="hint">Each dot is one run; open it to see why it passed or failed.</p>
        <table>
          <thead>
            <tr>
              <th>Task</th>
              <th>Group</th>
              <th class="side-a">A runs</th>
              <th class="side-b">B runs</th>
              <th class="num">B − A</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in r.tasks" :key="t.taskId">
              <td>
                {{ t.title }}
                <div class="muted mono">{{ t.key }}</div>
              </td>
              <td class="cap">{{ t.group }}</td>
              <td><PassDots :runs="t.a" side="a" /></td>
              <td><PassDots :runs="t.b" side="b" /></td>
              <td class="num">
                {{
                  t.a.length && t.b.length
                    ? points(
                        t.b.filter((x) => x.passed).length / t.b.length -
                          t.a.filter((x) => x.passed).length / t.a.length,
                      )
                    : '—'
                }}
              </td>
              <td>
                <RouterLink
                  v-if="t.a.length && t.b.length"
                  :to="`/experiments/${e.id}/tasks/${t.taskId}`"
                >
                  Compare
                </RouterLink>
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </template>
</template>

<style scoped>
.hypothesis {
  background: var(--accent-soft);
  border-color: transparent;
}
.progress-card .row {
  justify-content: space-between;
}
.bar {
  display: flex;
  height: 8px;
  border-radius: 4px;
  background: var(--surface-2);
  overflow: hidden;
  margin-top: 8px;
}
.bar .scored {
  background: var(--good);
}
.bar .error {
  background: var(--bad);
}
.bar .running {
  background: var(--accent);
  opacity: 0.6;
}
.cap {
  text-transform: capitalize;
}
.spaced {
  margin-top: 20px;
}
.regressions {
  margin-top: 12px;
}
.badge + .badge {
  margin-left: 4px;
}
</style>
