<script setup lang="ts">
import type {
  CheckResult,
  Configuration,
  CrmState,
  JudgeReport,
  RunEvent,
  RunStatus,
  TaskDefinition,
} from '@evals/shared';
import { computed, nextTick, ref, toRef } from 'vue';
import { RouterLink } from 'vue-router';
import ChecksPanel from '../components/ChecksPanel.vue';
import CrmChanges from '../components/CrmChanges.vue';
import StatusBadge from '../components/StatusBadge.vue';
import Timeline from '../components/Timeline.vue';
import { reviewReturn, useReviewNavigation } from '../composables/useReviewNavigation.js';
import { useResource } from '../composables/useResource.js';
import { useExperimentEvents } from '../composables/useExperimentEvents.js';
import { label, money, percent, seconds } from '../format.js';
import { configurationName, taskName } from '../names.js';

interface RunDetail {
  run: {
    id: string;
    experimentId: string;
    taskId: string;
    repetition: number;
    status: RunStatus;
    attempts: number;
    attemptLog: { attempt: number; kind: string; detail: string; at: string }[];
    errorKind: string | null;
    errorDetail: string | null;
    passed: boolean | null;
    score: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
    costUsd: number | null;
    judge: JudgeReport | null;
    judgeCostUsd: number | null;
    durationMs: number | null;
    leadFallbacks: number | null;
    crmInitial: CrmState | null;
    crmFinal: CrmState | null;
    context: {
      rescoring?: {
        sourceRunId: string;
        evaluatorVersion: string;
        mode?: 'judge-and-score' | 'score-only';
        sourceJudgeVersion?: string;
      };
      systemPrompts: (string | null)[];
      model: string | null;
      billingProvider: string | null;
      skills: string[];
      skillMode: string;
      memoryBefore: string | null;
      memoryAfter: string | null;
      userProfileAfter: string | null;
      auxiliaryCalls: number;
      lead: { model: string; calls: number; costUsd: number | null } | null;
    } | null;
  };
  task: { id: string; key: string; title: string; definition: TaskDefinition };
  configuration: Configuration;
  events: RunEvent[];
  checks: CheckResult[];
}

const props = defineProps<{ id: string }>();
const { data, error, reload } = useResource<RunDetail>(
  computed(() => `/runs/${toRef(props, 'id').value}`),
);
useExperimentEvents(
  computed(() => data.value?.run.experimentId ?? ''),
  (event) => {
    if (
      (!event?.runId || event.runId === props.id) &&
      (data.value?.run.status === 'queued' || data.value?.run.status === 'running')
    )
      void reload();
  },
);

const tab = ref<'crm' | 'context' | 'attempts'>('crm');
const highlighted = ref<number[]>([]);
const focusPath = ref<string | null>(null);

async function focusEvents(seqs: number[]) {
  highlighted.value = seqs;
  await nextTick();
  document
    .getElementById(`event-${seqs[0]}`)
    ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function focusState(path: string) {
  tab.value = 'crm';
  focusPath.value = path;
  await nextTick();
  document.getElementById('run-tabs')?.scrollIntoView({ behavior: 'smooth' });
}

const failedChecks = computed(
  () => data.value?.checks.filter((c) => !c.passed && !c.skipped && !c.informational) ?? [],
);
const spec = computed(() => data.value?.configuration.spec);
const { backTo, backLabel, detailLink, goBack } = useReviewNavigation(
  computed(() => `/experiments/${data.value?.run.experimentId ?? ''}?section=scenarios`),
);
const comparisonBackTo = computed(() => {
  if (!data.value) return backTo.value;
  const path = `/experiments/${data.value.run.experimentId}/tasks/${data.value.task.id}`;
  if (backTo.value.split('?')[0] !== path) return backTo.value;
  const origin = new URL(backTo.value, window.location.origin);
  return reviewReturn(
    origin.searchParams.get('returnTo'),
    `/experiments/${data.value.run.experimentId}?section=scenarios`,
  );
});
</script>

<template>
  <p v-if="error" class="error">{{ error }}</p>
  <p v-else-if="!data" class="muted" role="status">Loading conversation…</p>
  <template v-else-if="data">
    <p v-if="data.run.context?.rescoring" class="notice">
      Rescored saved conversation · {{ data.run.context.rescoring.evaluatorVersion }}. No new agent
      or customer calls.
      <span v-if="data.run.context.rescoring.mode === 'score-only'"
        >Reused {{ data.run.context.rescoring.sourceJudgeVersion }} judgments; no new judge
        calls.</span
      >
      <RouterLink :to="`/runs/${data.run.context.rescoring.sourceRunId}`"
        >Original run and scores →</RouterLink
      >
    </p>
    <div class="page-head">
      <div>
        <p class="subtitle">
          <a :href="backTo" @click="goBack">← {{ backLabel }}</a> ·
          <RouterLink
            :to="{
              path: `/experiments/${data.run.experimentId}/tasks/${data.task.id}`,
              query: { repetition: data.run.repetition, returnTo: comparisonBackTo },
            }"
            >Compare A and B on this task</RouterLink
          >
        </p>
        <p class="page-kicker">Run details · repetition {{ data.run.repetition }}</p>
        <h1>{{ taskName(data.task) }}</h1>
        <p class="subtitle">
          <RouterLink :to="detailLink(`/tasks/${data.task.id}`)" class="mono">{{
            data.task.key
          }}</RouterLink>
          · configuration
          <RouterLink :to="detailLink(`/configurations/${data.configuration.id}`)"
            ><strong>{{ configurationName(data.configuration) }}</strong></RouterLink
          >
          · repetition
          {{ data.run.repetition }}
        </p>
      </div>
      <div class="row">
        <StatusBadge v-if="data.run.status !== 'scored'" :status="data.run.status" />
        <span v-else-if="data.run.passed === null || data.run.score === null" class="badge big warn"
          >Needs grading</span
        >
        <span v-else class="badge big" :class="data.run.passed ? 'good' : 'bad'">
          {{ data.run.passed ? 'Passed' : 'Failed' }} · score {{ data.run.score }}
        </span>
      </div>
    </div>

    <details class="card">
      <summary>Run details · model, usage and configuration</summary>
      <div class="facts">
        <div>
          <span class="muted">Model</span> {{ data.run.context?.model ?? spec?.model }} ({{
            data.run.context?.billingProvider ?? spec?.provider
          }})
        </div>
        <div>
          <span class="muted">Skills</span>
          {{ spec?.skills.length ? `${spec.skills.join(', ')} (${spec.skillMode})` : 'none' }}
        </div>
        <div><span class="muted">Memory</span> {{ spec?.memory.enabled ? 'on' : 'off' }}</div>
        <div>
          <span class="muted">{{
            data.run.context?.rescoring ? 'New agent cost (replay)' : 'Agent cost'
          }}</span>
          {{ money(data.run.costUsd) }}
        </div>
        <div>
          <span class="muted">{{
            data.run.context?.rescoring ? 'Original conversation time' : 'Time'
          }}</span>
          {{ seconds(data.run.durationMs) }}
        </div>
        <div>
          <span class="muted">{{
            data.run.context?.rescoring ? 'New agent tokens (replay)' : 'Tokens'
          }}</span>
          {{ (data.run.inputTokens ?? 0) + (data.run.outputTokens ?? 0) }}
        </div>
        <div><span class="muted">Hermes attempts</span> {{ data.run.attempts }}</div>
        <div v-if="data.run.judge">
          <span class="muted">Outcome</span> {{ label(data.run.judge.outcome.label) }}
        </div>
        <div v-if="data.run.judge">
          <span class="muted">Reply quality</span> {{ percent(data.run.judge.replyQuality) }}
        </div>
        <div>
          <span class="muted">Judge</span>
          {{
            data.run.judge
              ? `${data.run.judge.model} · ${money(data.run.judgeCostUsd)}`
              : 'not judged'
          }}
        </div>
        <div v-if="data.run.judge?.evaluatorVersion">
          <span class="muted">Judge version</span> {{ data.run.judge.evaluatorVersion }}
        </div>
        <div v-if="data.run.judge?.groundingClassifier">
          <span class="muted">Grounding severity</span>
          {{ data.run.judge.groundingClassifier.model }} ·
          {{ money(data.run.judge.groundingClassifier.costUsd) }}
        </div>
        <div v-if="data.run.context?.lead">
          <span class="muted">Lead</span> {{ data.run.context.lead.model }} ·
          {{ data.run.context.lead.calls }} calls · {{ money(data.run.context.lead.costUsd) }}
        </div>
        <div v-else>
          <span class="muted">Lead fallbacks</span> {{ data.run.leadFallbacks ?? '—' }}
        </div>
      </div>
    </details>

    <div v-if="data.run.status === 'error'" class="card">
      <strong class="error">This run could not be scored ({{ data.run.errorKind }}).</strong>
      <p class="mono">{{ data.run.errorDetail }}</p>
      <p class="hint">
        Infrastructure failures are excluded from the comparison and shown as missing coverage.
      </p>
    </div>

    <div
      v-if="data.run.status === 'scored'"
      class="card why"
      :class="data.run.passed ? 'pass' : 'fail'"
    >
      <template v-if="data.run.passed === null || data.run.score === null"
        ><strong>Needs grading:</strong> A required judgment is missing or could not be verified.
        This run has no final score and is excluded from the comparison.</template
      >
      <template v-else-if="data.run.passed">
        <strong>Why it passed:</strong>{{ ' ' }}every critical check passed and the score ({{
          data.run.score
        }}) cleared {{ data.task.definition.passThreshold }}.
      </template>
      <template v-else>
        <strong>Why it failed:</strong>{{ ' ' }}
        <ul class="failure-summary">
          <li v-for="c in failedChecks" :key="c.checkId">
            {{ c.label }}<span v-if="c.critical" class="badge bad">critical</span>
          </li>
        </ul>
        <p v-if="!failedChecks.length" class="hint">
          The weighted score did not reach the task's pass threshold.
        </p>
        <span class="hint"
          >Details and source evidence are in Checks below. Reply-style findings do not affect
          pass/fail.</span
        >
      </template>
    </div>

    <div v-if="data.run.judge && !data.run.judge.leadConsistent.ok" class="card warning">
      <strong>The simulated customer broke character in this run</strong> ({{
        data.run.judge.leadConsistent.reason
      }}). Treat this run as a test problem, not an agent problem.
    </div>
    <div v-if="data.run.judge?.firstProblemSeq" class="card first-problem">
      First problem in Hermes's replies:
      <button @click="focusEvents([data.run.judge.firstProblemSeq])">
        show message #{{ data.run.judge.firstProblemSeq }}
      </button>
    </div>

    <div class="layout run-evidence-layout">
      <section class="card conversation-panel">
        <h2>Conversation</h2>
        <p class="panel-caption">
          Customer messages and the agent’s exact replies. Technical activity is hidden until
          needed.
        </p>
        <Timeline
          :events="data.events"
          :highlighted="highlighted"
          :judgments="data.run.judge?.turns"
          :lead-labels="data.run.judge?.leadTurns"
        />
      </section>
      <aside class="card checks-col">
        <h2>Checks</h2>
        <p class="panel-caption">
          Review each decision and its evidence. Reply-style checks do not affect pass/fail.
        </p>
        <ChecksPanel :checks="data.checks" @focus="focusEvents" @state="focusState" />
      </aside>
    </div>

    <section id="run-tabs" class="card">
      <div class="tabs">
        <button
          :class="{ active: tab === 'crm' }"
          :aria-pressed="tab === 'crm'"
          @click="tab = 'crm'"
        >
          CRM changes
        </button>
        <button
          :class="{ active: tab === 'context' }"
          :aria-pressed="tab === 'context'"
          @click="tab = 'context'"
        >
          What Hermes saw
        </button>
        <button
          :class="{ active: tab === 'attempts' }"
          :aria-pressed="tab === 'attempts'"
          @click="tab = 'attempts'"
        >
          Attempts ({{ data.run.attempts }})
        </button>
      </div>

      <CrmChanges
        v-if="tab === 'crm' && data.run.crmInitial && data.run.crmFinal"
        :before="data.run.crmInitial"
        :after="data.run.crmFinal"
        :focus-path="focusPath"
      />
      <p v-if="tab === 'crm' && (!data.run.crmInitial || !data.run.crmFinal)" class="muted">
        CRM snapshots are not available for this run yet.
      </p>
      <p v-if="tab === 'context' && !data.run.context" class="muted">
        Agent context has not been recorded for this run yet.
      </p>

      <div v-if="tab === 'context' && data.run.context" class="context">
        <p class="hint">
          Exactly what this run's Hermes home contained. Extra model calls Hermes made on its own:
          {{ data.run.context.auxiliaryCalls }}.
        </p>
        <details v-for="(prompt, i) in data.run.context.systemPrompts" :key="i" :open="i === 0">
          <summary>
            System prompt, session {{ i + 1 }} ({{ prompt?.length ?? 0 }} characters)
          </summary>
          <pre>{{ prompt ?? 'not recorded' }}</pre>
        </details>
        <div class="grid-2">
          <div>
            <h3>Memory before the run</h3>
            <pre>{{ data.run.context.memoryBefore ?? '(empty)' }}</pre>
          </div>
          <div>
            <h3>Memory after the run</h3>
            <pre>{{ data.run.context.memoryAfter ?? '(empty)' }}</pre>
          </div>
        </div>
      </div>

      <div v-if="tab === 'attempts'">
        <p v-if="data.run.context?.rescoring" class="muted">
          Replay of a saved conversation; no new Hermes execution attempts.
        </p>
        <p v-else-if="!data.run.attemptLog.length" class="muted">
          {{
            data.run.status === 'scored'
              ? 'Scored on the first attempt.'
              : 'No attempt problems recorded.'
          }}
        </p>
        <table v-else>
          <thead>
            <tr>
              <th>Attempt</th>
              <th>Problem</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="a in data.run.attemptLog" :key="a.attempt">
              <td>{{ a.attempt }}</td>
              <td>
                <span class="badge bad">{{ a.kind }}</span>
              </td>
              <td class="mono">{{ a.detail }}</td>
            </tr>
          </tbody>
        </table>
        <p class="hint">
          Every attempt starts from a fresh Hermes home and a fresh CRM, so a retry can't
          double-book anything.
        </p>
      </div>
    </section>
  </template>
</template>

<style scoped>
.big {
  font-size: 15px;
  padding: 4px 12px;
}
.facts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 24px;
}
.facts .muted {
  margin-right: 4px;
}
.warning {
  border-left: 4px solid var(--warn);
}
.first-problem {
  display: flex;
  align-items: center;
  gap: 8px;
}
.why.pass {
  border-left: 4px solid var(--good);
}
.why.fail {
  border-left: 4px solid var(--bad);
}
.layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 380px;
  gap: 16px;
  align-items: start;
}
.failure-summary {
  margin: 8px 0;
  padding-left: 20px;
}
.failure-summary li {
  margin-bottom: 4px;
}
.checks-col {
  position: sticky;
  top: 16px;
  max-height: calc(100vh - 32px);
  overflow-y: auto;
}
.context details {
  margin-bottom: 12px;
}
.context summary {
  cursor: pointer;
  font-weight: 600;
  margin-bottom: 6px;
}
@media (max-width: 960px) {
  .layout {
    grid-template-columns: 1fr;
  }
  .checks-col {
    position: static;
    max-height: none;
  }
}
</style>
