<script setup lang="ts">
import type {
  Configuration,
  ExperimentResults,
  ExperimentSummary,
  RunSummary,
} from '@evals/shared';
import { computed, onBeforeUnmount, ref, toRef } from 'vue';
import { RouterLink } from 'vue-router';
import { api } from '../api.js';
import PassDots from '../components/PassDots.vue';
import StatusBadge from '../components/StatusBadge.vue';
import VerdictCard from '../components/VerdictCard.vue';
import GradeChanges from '../components/GradeChanges.vue';
import { useExperimentEvents } from '../composables/useExperimentEvents.js';
import { useResource } from '../composables/useResource.js';
import { ISSUE_TEXT, label, money, percent, points, seconds } from '../format.js';
import { configurationName, experimentName, groupName, taskName } from '../names.js';

const props = defineProps<{ id: string }>();
const id = toRef(props, 'id');

const experiment = useResource<ExperimentSummary>(computed(() => `/experiments/${id.value}`));
const results = useResource<ExperimentResults>(computed(() => `/experiments/${id.value}/results`));
const runs = useResource<RunSummary[]>(computed(() => `/experiments/${id.value}/runs`));
const { data: configurations } = useResource<Configuration[]>('/configurations');

let pending: ReturnType<typeof setTimeout> | undefined;
onBeforeUnmount(() => clearTimeout(pending));
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
const activeSection = ref<'overview' | 'scenarios' | 'evidence'>('overview');

const groupCopy: Record<string, string> = {
  policy: 'Checks whether the agent follows clinic rules and escalates safely.',
  control: 'Protects core behavior that should continue working in both versions.',
  memory: 'Checks whether the agent uses details from an earlier conversation.',
};

function groupDescription(group: string) {
  return groupCopy[group.toLowerCase()] ?? 'Checks one specific part of the agent experience.';
}

function taskDifference(task: ExperimentResults['tasks'][number]) {
  if (!task.a.length || !task.b.length) return '—';
  return points(
    task.b.filter((run) => run.passed).length / task.b.length -
      task.a.filter((run) => run.passed).length / task.a.length,
  );
}
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
      label: e.value?.rescoring
        ? 'New agent cost per rescore (excludes judge)'
        : 'Agent cost per run',
      a: money(m.costUsd.a),
      b: money(m.costUsd.b),
      diff: m.costUsd.difference === null ? '—' : money(m.costUsd.difference),
      ci: m.costUsd.ci?.map((x) => money(x)).join(' to ') ?? '',
    },
    {
      label: e.value?.rescoring ? 'Original conversation time per run' : 'Time per run',
      a: seconds(m.durationMs.a),
      b: seconds(m.durationMs.b),
      diff: seconds(m.durationMs.difference),
      ci: m.durationMs.ci?.map((x) => seconds(x)).join(' to ') ?? '',
    },
    {
      label: e.value?.rescoring ? 'New agent tokens per rescore' : 'Tokens per run',
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
      label: 'Reply quality: written to the customer, SMS style (not part of pass/fail)',
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
  <p v-else-if="!e" class="muted" role="status">Loading experiment…</p>
  <template v-else-if="e">
    <RouterLink to="/" class="back-link" aria-label="Back to experiments">
      <span aria-hidden="true">←</span> All experiments
    </RouterLink>

    <div class="page-head">
      <div>
        <p class="page-kicker">Experiment results</p>
        <div class="row">
          <h1>{{ experimentName(e) }}</h1>
          <StatusBadge :status="e.status" />
        </div>
        <p class="subtitle">
          Compare the starting version with the proposed change. Open a scenario or run to inspect
          the evidence.
        </p>
      </div>
      <div class="row">
        <button v-if="e.status === 'draft'" class="primary" :disabled="busy" @click="act('start')">
          Start {{ e.taskIds.length * e.repetitions * 2 }} runs
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
    <p v-if="e.rescoring" class="notice">
      Corrected scoring · {{ e.rescoring.evaluatorVersion }}.
      <span v-if="e.rescoring.scope"
        >Focused rejudge: {{ e.rescoring.scope.tasks }} of
        {{ e.rescoring.scope.sourceTasks }} tasks, {{ e.rescoring.scope.runs }} of
        {{ e.rescoring.scope.sourceRuns }} saved runs. The previous full-suite result is
        preserved.</span
      >{{ ' ' }}
      <template v-if="e.rescoring.mode === 'score-only'">
        Reused saved conversations and {{ e.rescoring.sourceJudgeVersions?.join(', ') }} judgments.
        No new model calls or spend.
      </template>
      <template v-else
        >Fresh model judgments on {{ e.rescoring.scope ? 'the selected' : 'all' }} saved
        conversations; no Hermes or customer calls. Judge-only spend
        {{ money(e.rescoring.judgeOnlyCostUsd) }}.</template
      >{{ ' ' }}
      <span v-if="e.rescoring.changes">
        {{ e.rescoring.changes.passToFail }} pass → fail; {{ e.rescoring.changes.failToPass }} fail
        → pass; {{ e.rescoring.changes.unchanged }} unchanged pass/fail outcomes;
        {{ e.rescoring.changes.scoreChanges }} numeric scores changed;
        {{ e.rescoring.changes.ungraded }} need grading.
      </span>
      <RouterLink :to="`/experiments/${e.rescoring.sourceExperimentId}`"
        >Original scores →</RouterLink
      >
    </p>
    <p v-if="e.correctedExperimentId" class="notice">
      Original evaluator scores are preserved for audit and superseded by a versioned correction.
      <RouterLink :to="`/experiments/${e.correctedExperimentId}`"
        >View corrected results →</RouterLink
      >
    </p>

    <nav class="detail-tabs" aria-label="Experiment sections">
      <button
        :class="{ active: activeSection === 'overview' }"
        :aria-pressed="activeSection === 'overview'"
        @click="activeSection = 'overview'"
      >
        Overview
      </button>
      <button
        :class="{ active: activeSection === 'scenarios' }"
        :aria-pressed="activeSection === 'scenarios'"
        @click="activeSection = 'scenarios'"
      >
        Scenarios <span class="tab-count">{{ e.taskIds.length }}</span>
      </button>
      <button
        :class="{ active: activeSection === 'evidence' }"
        :aria-pressed="activeSection === 'evidence'"
        @click="activeSection = 'evidence'"
      >
        Metrics &amp; evidence
      </button>
    </nav>

    <div v-if="activeSection === 'overview'">
      <p v-if="results.error.value" class="error">
        Could not load results: {{ results.error.value }}
      </p>
      <p v-else-if="results.loading.value && !r" class="muted" role="status">Loading results…</p>
      <VerdictCard
        v-if="r && (r.coverage.scoredRuns > 0 || r.coverage.ungradedRuns > 0)"
        :results="r"
        :provisional="r.coverage.openRuns > 0"
      />
      <GradeChanges v-if="e.rescoring" :experiment-id="e.id" />
      <details class="setup-card">
        <summary>
          Setup &amp; hypothesis · {{ e.taskIds.length }} scenarios × 2 versions ×
          {{ e.repetitions }} {{ e.repetitions === 1 ? 'repetition' : 'repetitions' }}
        </summary>
        <div class="section-kicker">Experiment setup</div>
        <p class="hint">Original saved name: {{ e.name }}</p>
        <h2>How the {{ total || e.taskIds.length * e.repetitions * 2 }} runs are created</h2>
        <p class="setup-intro">
          A run is one complete agent conversation for one scenario, using one agent version.
        </p>
        <div class="run-formula" aria-label="Run count calculation">
          <div class="formula-part">
            <strong>{{ e.taskIds.length }}</strong>
            <span>realistic scenarios</span>
          </div>
          <span class="formula-symbol">×</span>
          <div class="formula-part">
            <strong>2</strong>
            <span>agent versions</span>
          </div>
          <span class="formula-symbol">×</span>
          <div class="formula-part">
            <strong>{{ e.repetitions }}</strong>
            <span>tries per version</span>
          </div>
          <span class="formula-symbol">=</span>
          <div class="formula-part formula-total">
            <strong>{{ e.taskIds.length * e.repetitions * 2 }}</strong>
            <span>total runs</span>
          </div>
        </div>
        <button class="text-action" @click="activeSection = 'scenarios'">
          See the {{ e.taskIds.length }} scenarios and what each tests →
        </button>
        <p v-if="e.hypothesis" class="hint">Hypothesis recorded at creation: {{ e.hypothesis }}</p>
      </details>

      <section class="comparison-strip" aria-label="Compared agent versions">
        <div>
          <span class="version-label">A · Baseline</span>
          <RouterLink :to="`/configurations/${e.baselineConfigId}`" class="detail-link"
            ><strong>{{ configurationName(baseline) }}</strong></RouterLink
          >
          <small>The current agent</small>
        </div>
        <span class="versus">compared with</span>
        <div>
          <span class="version-label">B · Candidate</span>
          <RouterLink :to="`/configurations/${e.candidateConfigId}`" class="detail-link"
            ><strong>{{ configurationName(candidate) }}</strong></RouterLink
          >
          <small>The proposed change</small>
        </div>
      </section>

      <div v-if="e.status === 'draft'" class="card">
        This experiment has not started. Running it will create
        {{ e.taskIds.length * e.repetitions * 2 }} agent conversations.
      </div>

      <section v-if="total" class="run-status">
        <div class="run-status-copy">
          <span class="section-kicker">Run status</span>
          <strong>{{ done }} of {{ total }} finished</strong>
          <p>
            {{ e.counts.scored }} scored · {{ e.counts.running }} running ·
            {{ e.counts.queued }} queued<span v-if="e.counts.error">
              · {{ e.counts.error }} technical failures</span
            >
          </p>
        </div>
        <div class="run-status-meta">
          <span>Total spend</span>
          <strong>{{ money(e.costUsd) }}</strong>
        </div>
        <div v-if="e.status === 'running'" class="bar" aria-hidden="true">
          <span class="scored" :style="{ width: `${(e.counts.scored / total) * 100}%` }" />
          <span class="error" :style="{ width: `${(e.counts.error / total) * 100}%` }" />
          <span class="running" :style="{ width: `${(e.counts.running / total) * 100}%` }" />
        </div>
        <p v-if="errorKinds.length" class="hint run-errors">
          Technical failures are excluded from the comparison:
          <span v-for="[kind, n] in errorKinds" :key="kind" class="badge bad"
            >{{ kind }} × {{ n }}</span
          >
        </p>
      </section>

      <template v-if="r && (r.coverage.scoredRuns > 0 || r.coverage.ungradedRuns > 0)">
        <section class="card findings-card">
          <div class="section-heading">
            <div>
              <span class="section-kicker">What changed</span>
              <h2>Performance by scenario group</h2>
            </div>
            <button class="text-action" @click="activeSection = 'evidence'">
              Open full evidence →
            </button>
          </div>
          <div class="group-list">
            <div v-for="g in r.groups" :key="g.group" class="group-result">
              <div>
                <strong>{{ groupName(g.group) }}</strong>
                <span>{{ g.tasks }} {{ g.tasks === 1 ? 'scenario' : 'scenarios' }}</span>
              </div>
              <div class="group-rates">
                <span>A {{ percent(g.passRateA) }}</span>
                <span>B {{ percent(g.passRateB) }}</span>
                <strong>{{ points(g.difference) }}</strong>
              </div>
            </div>
          </div>
        </section>
      </template>
    </div>

    <div v-else-if="activeSection === 'scenarios'">
      <section class="section-intro">
        <span class="section-kicker">Scenario library</span>
        <h2>What the agent was asked to handle</h2>
        <p>
          Each scenario describes a realistic customer situation. Both agent versions handled it
          {{ e.repetitions }} times, so you can see whether the behavior is consistent—not a lucky
          result.
        </p>
      </section>

      <section v-if="r?.tasks.length" class="scenario-list">
        <article
          v-for="(t, index) in r.tasks"
          :key="t.taskId"
          class="scenario-row"
          :data-testid="`scenario-${t.key}`"
        >
          <div class="scenario-number">{{ String(index + 1).padStart(2, '0') }}</div>
          <div class="scenario-copy">
            <div class="scenario-meta">
              <span class="badge">{{ groupName(t.group) }}</span>
              <span>{{ groupDescription(t.group) }}</span>
            </div>
            <h3>
              <RouterLink :to="`/tasks/${t.taskId}`" class="detail-link">{{
                taskName(t)
              }}</RouterLink>
            </h3>
            <span class="scenario-id">Scenario ID · {{ t.key }}</span>
          </div>
          <div class="scenario-results">
            <div>
              <span>A · Baseline</span>
              <PassDots :runs="t.a" :summaries="runs.data.value" side="a" />
            </div>
            <div>
              <span>B · Candidate</span>
              <PassDots :runs="t.b" :summaries="runs.data.value" side="b" />
            </div>
          </div>
          <div class="scenario-delta">
            <span>Change</span>
            <strong>{{ taskDifference(t) }}</strong>
          </div>
          <RouterLink
            v-if="t.a.length && t.b.length"
            class="button compare-button"
            :to="`/experiments/${e.id}/tasks/${t.taskId}`"
          >
            Compare runs
          </RouterLink>
        </article>
      </section>
      <div v-else class="card empty">Scenario results will appear once runs have been scored.</div>
      <p class="legend">
        <span><b class="legend-dot pass">✓</b> passed</span>
        <span><b class="legend-dot fail">✗</b> failed</span>
        Select a dot to open the full conversation and scoring evidence.
      </p>
    </div>

    <div
      v-else-if="
        activeSection === 'evidence' &&
        r &&
        (r.coverage.scoredRuns > 0 || r.coverage.ungradedRuns > 0)
      "
    >
      <section class="section-intro">
        <span class="section-kicker">Technical detail</span>
        <h2>Metrics &amp; evidence</h2>
        <p>
          Use this section to audit the verdict. The overview is the recommended starting point.
        </p>
      </section>

      <section v-if="r.improvement.judgedRuns.a + r.improvement.judgedRuns.b" class="card">
        <h2>Where Hermes can improve</h2>
        <p class="hint">
          From the judge's labels on every message ({{ r.improvement.judgedRuns.a }} A runs and
          {{ r.improvement.judgedRuns.b }} B runs judged). Each problem is backed by a quote from
          the reply.
        </p>
        <div class="grid-2">
          <div class="table-scroll">
            <h3>Problems in Hermes's replies</h3>
            <p v-if="!r.improvement.issues.length" class="muted">No problems found.</p>
            <table v-else>
              <thead>
                <tr>
                  <th>Problem</th>
                  <th class="num side-a">A</th>
                  <th class="num side-b">B</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="issue in r.improvement.issues" :key="issue.label">
                  <td>{{ ISSUE_TEXT[issue.label] ?? label(issue.label) }}</td>
                  <td class="num">
                    {{ percent(issue.a) }} <span class="hint">({{ issue.countA }})</span>
                  </td>
                  <td class="num">
                    {{ percent(issue.b) }} <span class="hint">({{ issue.countB }})</span>
                  </td>
                  <td>
                    <RouterLink v-if="issue.exampleRunId" :to="`/runs/${issue.exampleRunId}`"
                      >example</RouterLink
                    >
                  </td>
                </tr>
              </tbody>
            </table>
            <p class="hint">Share of Hermes's replies with the problem (number of replies).</p>
            <template v-if="r.improvement.groundingSeverities.length">
              <h3 class="spaced">Unsupported claims by Jev severity</h3>
              <table>
                <thead>
                  <tr>
                    <th>Severity</th>
                    <th class="num side-a">A</th>
                    <th class="num side-b">B</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in r.improvement.groundingSeverities" :key="row.severity">
                    <td>
                      {{ label(row.severity) }}
                      <span v-if="row.severity === 'serious'" class="badge warn">critical</span>
                    </td>
                    <td class="num">{{ row.countA }}</td>
                    <td class="num">{{ row.countB }}</td>
                    <td>
                      <RouterLink v-if="row.exampleRunId" :to="`/runs/${row.exampleRunId}`"
                        >example</RouterLink
                      >
                    </td>
                  </tr>
                </tbody>
              </table>
            </template>
          </div>
          <div class="table-scroll">
            <h3>How Hermes handles each kind of customer message</h3>
            <table>
              <thead>
                <tr>
                  <th>Customer message</th>
                  <th class="num side-a">A handled well</th>
                  <th class="num side-b">B handled well</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in r.improvement.intents" :key="row.intent">
                  <td>{{ label(row.intent) }}</td>
                  <td class="num">
                    {{ percent(row.handledA) }} <span class="hint">({{ row.countA }})</span>
                  </td>
                  <td class="num">
                    {{ percent(row.handledB) }} <span class="hint">({{ row.countB }})</span>
                  </td>
                </tr>
              </tbody>
            </table>
            <p class="hint">"Handled well": Hermes's next reply had no problems.</p>
          </div>
        </div>
        <div class="row outcomes">
          <strong>How conversations ended:</strong>
          <span v-for="o in r.improvement.outcomes" :key="o.label" class="badge">
            {{ label(o.label) }}: <span class="side-a">A {{ o.a }}</span> ·
            <span class="side-b">B {{ o.b }}</span>
          </span>
        </div>
        <p v-if="r.improvement.leadProblems.length" class="hint warn-text">
          The simulated customer broke character in
          {{ r.improvement.leadProblems.length }} run(s):
          <RouterLink
            v-for="p in r.improvement.leadProblems"
            :key="p.runId"
            :to="`/runs/${p.runId}`"
          >
            {{ p.taskKey }} ({{ p.side.toUpperCase() }})
          </RouterLink>
          — check those as test problems.
        </p>
      </section>

      <section class="card table-scroll">
        <div class="table-heading">
          <div>
            <h2>Performance metrics</h2>
            <p>All values are averages across comparable scenarios.</p>
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th>Metric</th>
              <th class="num side-a">A · Baseline</th>
              <th class="num side-b">B · Candidate</th>
              <th class="num">Change</th>
              <th class="num">95% range</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in metricRows" :key="row.label">
              <td>{{ row.label }}</td>
              <td class="num">{{ row.a }}</td>
              <td class="num">{{ row.b }}</td>
              <td class="num">{{ row.diff }}</td>
              <td class="num muted">{{ row.ci || '—' }}</td>
            </tr>
          </tbody>
        </table>
        <p class="table-note">
          {{ r.coverage.scoredRuns }} of {{ r.coverage.plannedRuns }} planned runs have complete
          grading.
          <span v-if="r.coverage.ungradedRuns"
            >{{ r.coverage.ungradedRuns }} need grading and are excluded from the comparison.</span
          >
          {{ r.comparison.pairedTasks }} of {{ r.comparison.plannedTasks }} scenarios have results
          for both versions.
        </p>
      </section>

      <div class="grid-2 evidence-grid">
        <section class="card">
          <h2>Checks that changed</h2>
          <p v-if="!r.checkFlips.length" class="muted">
            Every check passed equally often under A and B.
          </p>
          <div v-else class="check-list">
            <RouterLink
              v-for="f in r.checkFlips.slice(0, 12)"
              :key="`${f.taskId}/${f.checkId}`"
              class="check-row"
              :to="`/experiments/${e.id}/tasks/${f.taskId}`"
            >
              <span>
                <strong>{{ f.label }}</strong>
                <small
                  >{{
                    taskName(
                      r.tasks.find((t) => t.taskId === f.taskId) ?? {
                        key: f.taskKey,
                        title: f.taskKey,
                      },
                    )
                  }}
                  <em v-if="f.critical">· Critical</em></small
                >
              </span>
              <span>A {{ percent(f.passRateA) }} → B {{ percent(f.passRateB) }}</span>
            </RouterLink>
          </div>
          <div v-if="r.criticalRegressions.length" class="regressions">
            <strong class="error">Critical regressions found</strong>
            <p class="hint">Review these before shipping the candidate.</p>
          </div>
        </section>

        <section class="card">
          <h2>Hermes-native tools</h2>
          <p class="muted tool-intro">
            Share of runs using skills, memory or other Hermes-native tools. CRM calls are shown in
            each run’s conversation.
          </p>
          <div v-if="r.hermesToolUse.length" class="tool-list">
            <div v-for="t in r.hermesToolUse" :key="t.tool" class="tool-row">
              <code>{{ t.tool }}</code>
              <span>A {{ percent(t.a) }}</span>
              <span>B {{ percent(t.b) }}</span>
            </div>
          </div>
          <p v-else class="muted">
            No Hermes-native tool calls were recorded. This does not mean the agent made no CRM
            calls.
          </p>
        </section>
      </div>

      <details class="methodology">
        <summary>How the comparison is calculated</summary>
        <p>
          The result compares pass rates for B minus A across paired scenarios. The 95% range
          reflects uncertainty from both scenario selection and repeated runs. Costs use provider
          list-price estimates.
        </p>
      </details>
    </div>
    <div v-else-if="activeSection === 'evidence'" class="card empty">
      Evidence will appear after at least one run has been scored.
    </div>
  </template>
</template>

<style scoped>
.detail-link {
  color: inherit;
  text-decoration: underline;
  text-decoration-color: #b8b8b8;
  text-underline-offset: 3px;
}
.detail-link:hover,
.detail-link:focus-visible {
  text-decoration-color: currentColor;
}
.back-link {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 22px;
  color: #626262;
  font-size: 12.5px;
  font-weight: 630;
}
.back-link span {
  font-size: 17px;
  line-height: 1;
}
.page-head {
  margin-bottom: 23px;
}
.detail-tabs {
  display: flex;
  gap: 26px;
  margin-bottom: 28px;
  border-bottom: 1px solid var(--border);
}
.detail-tabs button {
  min-height: 42px;
  margin-bottom: -1px;
  padding: 0 0 12px;
  color: var(--muted);
  background: none;
  border: 0;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  box-shadow: none;
}
.detail-tabs button:hover {
  color: var(--text);
  background: none;
  border-color: transparent;
}
.detail-tabs button.active {
  color: var(--text);
  border-bottom-color: var(--text);
}
.tab-count {
  padding: 1px 6px;
  background: var(--surface-2);
  border-radius: 999px;
  font-size: 10px;
}
.setup-card {
  margin-bottom: 16px;
  padding: 16px 20px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
}
.section-kicker,
.version-label {
  display: block;
  margin-bottom: 6px;
  color: #777;
  font-size: 9.5px;
  font-weight: 750;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.setup-card h2,
.section-intro h2 {
  margin-bottom: 7px;
  font-size: 20px;
}
.setup-intro,
.section-intro p {
  max-width: 680px;
  margin-bottom: 22px;
  color: var(--muted);
}
.run-formula {
  display: grid;
  grid-template-columns: 1fr auto 1fr auto 1fr auto 1.15fr;
  align-items: stretch;
  gap: 14px;
  margin: 25px 0 18px;
}
.formula-part {
  min-height: 102px;
  padding: 18px;
  background: #fafafa;
  border: 1px solid var(--border);
  border-radius: 8px;
}
.formula-part strong {
  display: block;
  font-size: 26px;
  line-height: 1.1;
}
.formula-part span {
  display: block;
  margin-top: 8px;
  color: var(--muted);
  font-size: 11px;
}
.formula-total {
  color: #fff;
  background: #171717;
  border-color: #171717;
}
.formula-total span {
  color: #bfbfbf;
}
.formula-symbol {
  align-self: center;
  color: #999;
  font-size: 18px;
}
.text-action {
  min-height: 0;
  padding: 0;
  color: var(--text);
  background: transparent;
  border: 0;
  box-shadow: none;
  font-size: 12px;
}
.text-action:hover:not(:disabled) {
  background: transparent;
  border: 0;
  text-decoration: underline;
  text-underline-offset: 3px;
}
.comparison-strip {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 24px;
  margin-bottom: 16px;
  padding: 22px 28px;
  background: #fafafa;
  border: 1px solid var(--border);
  border-radius: var(--radius);
}
.comparison-strip > div {
  display: grid;
}
.comparison-strip strong {
  font-size: 15px;
}
.comparison-strip small {
  display: none;
  margin-top: 3px;
  color: var(--muted);
}
.versus {
  color: #999;
  font-size: 10px;
  text-transform: uppercase;
}
.hypothesis-line {
  display: grid;
  grid-template-columns: 145px 1fr;
  gap: 18px;
  margin-bottom: 16px;
  padding: 18px 28px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
}
.hypothesis-line > span {
  color: var(--muted);
  font-size: 11px;
  font-weight: 650;
}
.hypothesis-line p {
  margin: 0;
}
.run-status {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 14px 28px;
  margin-bottom: 16px;
  padding: 20px 28px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
}
.run-status-copy strong,
.run-status-meta strong {
  display: block;
  font-size: 16px;
}
.run-status-copy p,
.run-status-meta span {
  margin: 3px 0 0;
  color: var(--muted);
  font-size: 11px;
}
.run-status-meta {
  text-align: right;
}
.bar {
  grid-column: 1 / -1;
  display: flex;
  height: 5px;
  border-radius: 999px;
  background: var(--surface-2);
  overflow: hidden;
}
.bar .scored {
  background: var(--good);
}
.bar .error {
  background: var(--bad);
}
.bar .running {
  background: #8b8b8b;
}
.run-errors {
  grid-column: 1 / -1;
  margin: 0;
}
.findings-card {
  padding: 0;
  overflow: hidden;
}
.section-heading,
.table-heading {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  align-items: center;
  padding: 19px 22px;
  border-bottom: 1px solid var(--border);
}
.section-heading h2,
.table-heading h2,
.table-heading p {
  margin: 0;
}
.table-heading p {
  color: var(--muted);
  font-size: 11px;
}
.group-result {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 18px;
  align-items: center;
  padding: 15px 22px;
  border-bottom: 1px solid var(--border);
}
.group-result:last-child {
  border-bottom: 0;
}
.group-result > div:first-child {
  display: grid;
  gap: 2px;
}
.group-result > div:first-child span {
  color: var(--muted);
  font-size: 11px;
}
.group-rates {
  display: flex;
  gap: 20px;
  align-items: center;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.group-rates span {
  color: var(--muted);
}
.section-intro {
  margin-bottom: 22px;
}
.scenario-list {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}
.scenario-row {
  display: grid;
  grid-template-columns: 38px minmax(280px, 1fr) 260px 70px auto;
  gap: 18px;
  align-items: center;
  padding: 20px 22px;
  background: #fff;
  border-bottom: 1px solid var(--border);
}
.scenario-row:last-child {
  border-bottom: 0;
}
.scenario-number {
  align-self: start;
  padding-top: 3px;
  color: #aaa;
  font-family: var(--mono);
  font-size: 11px;
}
.scenario-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 7px;
  color: var(--muted);
  font-size: 10.5px;
}
.scenario-copy h3 {
  margin: 0 0 4px;
  font-size: 14px;
}
.scenario-id {
  color: #8b8b8b;
  font-family: var(--mono);
  font-size: 10px;
}
.scenario-results {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.scenario-results > div {
  display: grid;
  gap: 7px;
}
.scenario-results > div > span,
.scenario-delta span {
  color: var(--muted);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.scenario-delta {
  display: grid;
  gap: 4px;
  font-variant-numeric: tabular-nums;
}
.compare-button {
  min-height: 34px;
  padding: 6px 10px;
}
.legend {
  display: flex;
  gap: 16px;
  align-items: center;
  margin: 14px 3px 0;
  color: var(--muted);
  font-size: 10.5px;
}
.legend > span {
  display: inline-flex;
  gap: 5px;
  align-items: center;
}
.legend-dot {
  display: inline-grid;
  width: 18px;
  height: 18px;
  place-items: center;
  border-radius: 50%;
  font-size: 10px;
}
.legend-dot.pass {
  color: var(--text);
  background: var(--good-soft);
}
.legend-dot.fail {
  color: var(--bad);
  background: var(--bad-soft);
}
.evidence-grid {
  margin-top: 16px;
}
.check-list,
.tool-list {
  border-top: 1px solid var(--border);
}
.check-row,
.tool-row {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  padding: 12px 0;
  border-bottom: 1px solid var(--border);
  font-size: 11px;
}
.check-row > span:first-child {
  display: grid;
}
.check-row small,
.check-row > span:last-child,
.tool-row span,
.tool-intro {
  color: var(--muted);
  font-size: 10.5px;
}
.check-row em {
  color: var(--bad);
  font-style: normal;
}
.tool-row code {
  font-family: var(--mono);
}
.tool-row span:first-of-type {
  margin-left: auto;
}
.table-note {
  margin: 0;
  padding: 14px 18px;
  color: var(--muted);
  background: #fafafa;
  border-top: 1px solid var(--border);
  font-size: 10.5px;
}
.methodology {
  margin-top: 16px;
  padding: 15px 18px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--muted);
  font-size: 11px;
}
.methodology summary {
  color: var(--text);
  font-weight: 650;
}
.methodology p {
  max-width: 760px;
  margin: 12px 0 0;
}
.outcomes {
  margin-top: 12px;
}
.warn-text {
  color: var(--warn);
}
.warn-text a {
  margin-right: 6px;
}
.regressions {
  margin-top: 16px;
}
@media (max-width: 1050px) {
  .scenario-row {
    grid-template-columns: 30px 1fr 220px;
  }
  .scenario-delta,
  .compare-button {
    grid-column: 2;
  }
  .compare-button {
    justify-self: start;
  }
}
@media (max-width: 760px) {
  .run-formula {
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
  }
  .formula-symbol {
    display: none;
  }
  .formula-part {
    min-height: 90px;
    padding: 14px;
  }
  .formula-part strong {
    font-size: 22px;
  }
  .comparison-strip {
    grid-template-columns: 1fr;
  }
  .versus {
    display: none;
  }
  .scenario-row {
    grid-template-columns: 26px 1fr;
  }
  .scenario-results,
  .scenario-delta,
  .compare-button {
    grid-column: 2;
  }
  .group-result,
  .hypothesis-line {
    grid-template-columns: 1fr;
  }
  .group-rates {
    justify-content: space-between;
  }
}
@media (max-width: 520px) {
  .detail-tabs {
    gap: 18px;
    overflow-x: auto;
  }
  .setup-card,
  .comparison-strip,
  .run-status {
    padding: 20px;
  }
  .run-formula {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .scenario-meta > span:last-child {
    display: none;
  }
}
</style>
