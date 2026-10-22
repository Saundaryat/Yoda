<script setup lang="ts">
import type {
  CheckResult,
  Configuration,
  CrmState,
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
import { useResource } from '../composables/useResource.js';
import { money, seconds } from '../format.js';

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
    durationMs: number | null;
    leadFallbacks: number | null;
    crmInitial: CrmState | null;
    crmFinal: CrmState | null;
    context: {
      systemPrompts: (string | null)[];
      model: string | null;
      billingProvider: string | null;
      skills: string[];
      skillMode: string;
      memoryBefore: string | null;
      memoryAfter: string | null;
      userProfileAfter: string | null;
      auxiliaryCalls: number;
    } | null;
  };
  task: { id: string; key: string; title: string; definition: TaskDefinition };
  configuration: Configuration;
  events: RunEvent[];
  checks: CheckResult[];
}

const props = defineProps<{ id: string }>();
const { data, error } = useResource<RunDetail>(computed(() => `/runs/${toRef(props, 'id').value}`));

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

const failedChecks = computed(() => data.value?.checks.filter((c) => !c.passed) ?? []);
const spec = computed(() => data.value?.configuration.spec);
</script>

<template>
  <p v-if="error" class="error">{{ error }}</p>
  <template v-else-if="data">
    <div class="page-head">
      <div>
        <p class="subtitle">
          <RouterLink :to="`/experiments/${data.run.experimentId}`">← Experiment</RouterLink> ·
          <RouterLink :to="`/experiments/${data.run.experimentId}/tasks/${data.task.id}`"
            >Compare A and B on this task</RouterLink
          >
        </p>
        <h1>{{ data.task.title }}</h1>
        <p class="subtitle">
          <RouterLink :to="`/tasks/${data.task.id}`" class="mono">{{ data.task.key }}</RouterLink> ·
          configuration <strong>{{ data.configuration.name }}</strong> · repetition
          {{ data.run.repetition }}
        </p>
      </div>
      <div class="row">
        <StatusBadge v-if="data.run.status !== 'scored'" :status="data.run.status" />
        <span v-else class="badge big" :class="data.run.passed ? 'good' : 'bad'">
          {{ data.run.passed ? 'Passed' : 'Failed' }} · score {{ data.run.score }}
        </span>
      </div>
    </div>

    <div class="card facts">
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
      <div><span class="muted">Cost</span> {{ money(data.run.costUsd) }}</div>
      <div><span class="muted">Time</span> {{ seconds(data.run.durationMs) }}</div>
      <div>
        <span class="muted">Tokens</span>
        {{ (data.run.inputTokens ?? 0) + (data.run.outputTokens ?? 0) }}
      </div>
      <div><span class="muted">Attempts</span> {{ data.run.attempts }}</div>
      <div><span class="muted">Lead fallbacks</span> {{ data.run.leadFallbacks ?? '—' }}</div>
    </div>

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
      <template v-if="data.run.passed">
        <strong>Why it passed:</strong>{{ ' ' }}every critical check passed and the score ({{
          data.run.score
        }}) cleared {{ data.task.definition.passThreshold }}.
      </template>
      <template v-else>
        <strong>Why it failed:</strong>{{ ' ' }}
        <span v-for="(c, i) in failedChecks" :key="c.checkId">
          {{ i ? '; ' : '' }}{{ c.label }}<span v-if="c.critical"> (critical)</span> —
          {{ c.detail }}
        </span>
      </template>
    </div>

    <div class="layout">
      <section class="card">
        <h2>Conversation</h2>
        <Timeline :events="data.events" :highlighted="highlighted" />
      </section>
      <aside class="card checks-col">
        <h2>Checks</h2>
        <ChecksPanel :checks="data.checks" @focus="focusEvents" @state="focusState" />
      </aside>
    </div>

    <section id="run-tabs" class="card">
      <div class="tabs">
        <button :class="{ active: tab === 'crm' }" @click="tab = 'crm'">CRM changes</button>
        <button :class="{ active: tab === 'context' }" @click="tab = 'context'">
          What Hermes saw
        </button>
        <button :class="{ active: tab === 'attempts' }" @click="tab = 'attempts'">
          Attempts ({{ data.run.attempts }})
        </button>
      </div>

      <CrmChanges
        v-if="tab === 'crm' && data.run.crmInitial && data.run.crmFinal"
        :before="data.run.crmInitial"
        :after="data.run.crmFinal"
        :focus-path="focusPath"
      />

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
        <p v-if="!data.run.attemptLog.length" class="muted">Scored on the first attempt.</p>
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
