<script setup lang="ts">
import {
  MIN_TASKS_FOR_VERDICT,
  type Configuration,
  type CreateExperiment,
  type ExperimentSummary,
  type LeadMode,
} from '@evals/shared';
import { computed, ref, watch } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { api } from '../api.js';
import { useResource } from '../composables/useResource.js';
import { money } from '../format.js';
import { configurationName, groupName, taskName } from '../names.js';

interface TaskItem {
  id: string;
  key: string;
  title: string;
  split: 'dev' | 'eval';
  group: string;
  family: string;
}

const router = useRouter();
const { data: tasks, error: tasksError } = useResource<TaskItem[]>('/tasks');
const { data: configurations, error: configurationsError } =
  useResource<Configuration[]>('/configurations');
const { data: history } = useResource<ExperimentSummary[]>('/experiments');

const form = ref({
  name: '',
  hypothesis: '',
  baselineConfigId: '',
  candidateConfigId: '',
  repetitions: 3,
  leadMode: 'scripted' as LeadMode,
});
const selected = ref(new Set<string>());
const error = ref<string | null>(null);
const saving = ref(false);
watch(
  () => form.value.baselineConfigId,
  (id) => {
    if (form.value.candidateConfigId === id) form.value.candidateConfigId = '';
  },
);

// Default to the frozen eval split when it exists, otherwise the dev split.
watch(tasks, (list) => {
  if (!list || selected.value.size) return;
  const split = list.some((t) => t.split === 'eval') ? 'eval' : 'dev';
  selected.value = new Set(list.filter((t) => t.split === split).map((t) => t.id));
});

const sections = computed(() => {
  const groups = new Map<string, TaskItem[]>();
  for (const task of tasks.value ?? []) {
    const key = `${task.split === 'eval' ? 'Evaluation' : 'Development'} · ${groupName(task.group)}`;
    groups.set(key, [...(groups.get(key) ?? []), task]);
  }
  return [...groups.entries()].sort(
    ([a], [b]) =>
      Number(a.startsWith('Development')) - Number(b.startsWith('Development')) ||
      a.localeCompare(b),
  );
});

const splitCounts = computed(() => ({
  dev: (tasks.value ?? []).filter((task) => task.split === 'dev').length,
  eval: (tasks.value ?? []).filter((task) => task.split === 'eval').length,
}));
const scenarioShortfall = computed(() => Math.max(0, MIN_TASKS_FOR_VERDICT - selected.value.size));
const suiteShortfall = computed(() =>
  Math.max(0, MIN_TASKS_FOR_VERDICT - (tasks.value?.length ?? 0)),
);

function toggle(id: string) {
  const next = new Set(selected.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selected.value = next;
}

function selectSplit(split: 'dev' | 'eval') {
  selected.value = new Set((tasks.value ?? []).filter((t) => t.split === split).map((t) => t.id));
}

function selectAll() {
  selected.value = new Set((tasks.value ?? []).map((task) => task.id));
}

const runCount = computed(() => selected.value.size * 2 * form.value.repetitions);

/** Average cost per scored run in earlier experiments: a rough guide, not a quote. */
const costPerRun = computed(() => {
  const past = (history.value ?? []).filter(
    (e) =>
      !e.rescoring && e.leadMode === form.value.leadMode && e.counts.scored > 0 && e.costUsd > 0,
  );
  const runs = past.reduce((s, e) => s + e.counts.scored, 0);
  return runs ? past.reduce((s, e) => s + e.costUsd, 0) / runs : null;
});

const valid = computed(
  () =>
    form.value.name.trim() &&
    form.value.baselineConfigId &&
    form.value.candidateConfigId &&
    form.value.baselineConfigId !== form.value.candidateConfigId &&
    selected.value.size > 0 &&
    Number.isInteger(form.value.repetitions) &&
    form.value.repetitions >= 1 &&
    form.value.repetitions <= 10,
);
const baseline = computed(() =>
  configurations.value?.find((c) => c.id === form.value.baselineConfigId),
);
const candidate = computed(() =>
  configurations.value?.find((c) => c.id === form.value.candidateConfigId),
);
const differences = computed(() => {
  if (!baseline.value || !candidate.value) return [];
  const fields = {
    provider: 'Provider',
    model: 'Model',
    systemPrompt: 'Instructions',
    skills: 'Skills',
    skillMode: 'Skill loading',
    memory: 'Memory',
    toolsets: 'Tools',
    toolSearch: 'Tool search',
    reasoning: 'Reasoning',
  } as const;
  return Object.entries(fields)
    .filter(
      ([key]) =>
        JSON.stringify(baseline.value!.spec[key as keyof typeof fields]) !==
        JSON.stringify(candidate.value!.spec[key as keyof typeof fields]),
    )
    .map(([, label]) => label);
});

async function create() {
  if (!valid.value || saving.value) return;
  saving.value = true;
  error.value = null;
  try {
    const body: CreateExperiment = {
      ...form.value,
      name: form.value.name.trim(),
      taskIds: [...selected.value],
    };
    const experiment = await api<ExperimentSummary>('/experiments', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    await router.push(`/experiments/${experiment.id}`);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="page-head">
    <div>
      <p class="subtitle"><RouterLink to="/">← Experiments</RouterLink></p>
      <p class="page-kicker">Set up a comparison</p>
      <h1>New experiment</h1>
      <p class="subtitle">
        Creating the experiment makes no model calls. You start it on the next page.
      </p>
    </div>
  </div>

  <p v-if="tasksError || configurationsError" class="error" role="alert">
    Could not load setup options: {{ tasksError || configurationsError }}
  </p>
  <p v-else-if="!tasks || !configurations" class="card">Loading agent versions and scenarios…</p>
  <div v-else-if="configurations.length < 2" class="card">
    You need two configurations to compare.
    <RouterLink to="/configurations/new">Create a configuration</RouterLink>.
  </div>

  <form v-else class="setup-form" @submit.prevent="create">
    <div class="card">
      <h2><span class="setup-step">1</span> Describe the test</h2>
      <p class="panel-caption">Name the change you want to test before seeing the results.</p>
      <label class="field">
        <span>Name</span>
        <input
          v-model="form.name"
          placeholder="e.g. Does including the clinic policy improve booking?"
          required
        />
      </label>
      <label class="field">
        <span>Hypothesis</span>
        <textarea
          v-model="form.hypothesis"
          placeholder="What do you expect, written before the results? e.g. The skill helps the policy tasks; controls stay flat."
        />
      </label>
      <h2 class="setup-section"><span class="setup-step">2</span> Choose the two versions</h2>
      <p class="panel-caption">
        Keep the model and other settings the same when testing one change.
      </p>
      <label class="field">
        <span class="side-a">A — baseline</span>
        <select v-model="form.baselineConfigId" required>
          <option value="" disabled>Choose a configuration</option>
          <option v-for="c in configurations" :key="c.id" :value="c.id">
            {{ configurationName(c) }}
          </option>
        </select>
        <small>The starting version you want to compare against.</small>
      </label>
      <label class="field">
        <span class="side-b">B — candidate</span>
        <select v-model="form.candidateConfigId" required>
          <option value="" disabled>Choose a configuration</option>
          <option
            v-for="c in configurations"
            :key="c.id"
            :value="c.id"
            :disabled="c.id === form.baselineConfigId"
          >
            {{ configurationName(c) }}
          </option>
        </select>
        <small>The version containing your proposed change.</small>
      </label>
      <div v-if="baseline && candidate" class="setup-note">
        <strong>{{
          differences.length ? 'Settings that differ' : 'Identical settings (A/A control)'
        }}</strong>
        <p>
          {{
            differences.length
              ? differences.join(' · ')
              : 'These versions use the same settings. This comparison measures run-to-run variation.'
          }}
        </p>
      </div>
      <h2 class="setup-section"><span class="setup-step">3</span> Set the run conditions</h2>
      <label class="field">
        <span>Repetitions per task and configuration</span>
        <input v-model.number="form.repetitions" type="number" min="1" max="10" step="1" required />
        <small>Agents are not deterministic. 3 repetitions show how consistent each one is.</small>
      </label>
      <fieldset class="field lead">
        <legend>Who plays the customer?</legend>
        <label class="check">
          <input v-model="form.leadMode" type="radio" value="scripted" />
          <span>
            <strong>Scripted</strong> — fixed reply rules, shared by A and B. No customer-model
            cost; agent and judge calls are still paid.
          </span>
        </label>
        <label class="check">
          <input v-model="form.leadMode" type="radio" value="llm" />
          <span>
            <strong>LLM (Claude)</strong> — plays the customer from a persona: realistic, varied
            wording. Needs <span class="mono">ANTHROPIC_API_KEY</span>; adds a little cost per turn.
          </span>
        </label>
      </fieldset>
    </div>

    <div class="card scenario-picker">
      <h2><span class="setup-step">4</span> Choose the scenarios</h2>
      <p class="panel-caption">
        Both versions face the same selected scenarios, with a fresh Hermes home for each run.
      </p>
      <div class="row tasks-head">
        <span class="muted">{{ selected.size }} selected</span>
        <button type="button" @click="selectAll">All scenarios</button>
        <button v-if="splitCounts.eval" type="button" @click="selectSplit('eval')">
          Eval only ({{ splitCounts.eval }})
        </button>
        <button v-if="splitCounts.dev" type="button" @click="selectSplit('dev')">
          Dev only ({{ splitCounts.dev }})
        </button>
      </div>
      <p class="hint">
        Use development scenarios for tuning. Keep the evaluation selection frozen when comparing
        changes.
      </p>
      <div v-for="[section, items] in sections" :key="section" class="section">
        <h3>{{ section }}</h3>
        <label v-for="task in items" :key="task.id" class="check scenario-option">
          <input type="checkbox" :checked="selected.has(task.id)" @change="toggle(task.id)" />
          <span>{{ taskName(task) }}</span>
        </label>
      </div>
    </div>

    <section class="card setup-review" aria-label="Experiment review">
      <h2><span class="setup-step">5</span> Review your experiment</h2>
      <div class="setup-review-grid">
        <div>
          <span class="muted">A · Starting version</span
          ><strong>{{ baseline ? configurationName(baseline) : 'Choose a baseline' }}</strong>
        </div>
        <div>
          <span class="muted">B · Proposed version</span
          ><strong>{{ candidate ? configurationName(candidate) : 'Choose a candidate' }}</strong>
        </div>
        <div>
          <span class="muted">Customer</span
          ><strong>{{
            form.leadMode === 'scripted' ? 'Scripted reply rules' : 'Claude persona'
          }}</strong>
        </div>
      </div>
      <div class="summary">
        <div>
          <strong>{{ runCount }}</strong> runs ({{ selected.size }} tasks × 2 configurations ×
          {{ form.repetitions }})
        </div>
        <div class="muted">
          Estimated spend:
          {{
            costPerRun
              ? `about ${money(costPerRun * runCount)}`
              : 'no comparable conversation batch yet'
          }}
        </div>
      </div>
      <p class="hint">
        Cost is a rough guide from past conversation batches using the same customer mode, excluding
        rescores. Different models and conversation lengths will change it.
      </p>
      <div v-if="scenarioShortfall" class="coverage-warning">
        <strong>Exploratory result only</strong>
        <p v-if="suiteShortfall">
          This suite contains {{ tasks?.length ?? 0 }} scenarios. Add {{ suiteShortfall }} more
          {{ suiteShortfall === 1 ? 'scenario' : 'scenarios' }} before relying on a verdict; the
          evaluator requires at least {{ MIN_TASKS_FOR_VERDICT }}.
        </p>
        <p v-else>
          Only {{ selected.size }} scenarios selected. The comparison remains exploratory below
          {{ MIN_TASKS_FOR_VERDICT }} paired scenarios. More coverage does not guarantee a winner.
        </p>
      </div>
      <p v-if="error" class="error">{{ error }}</p>
      <div class="setup-actions">
        <p class="muted">Save a draft now. Review and start paid runs on the next page.</p>
        <button class="primary" type="submit" :disabled="!valid || saving">
          {{ saving ? 'Creating…' : 'Create experiment' }}
        </button>
      </div>
    </section>
  </form>
</template>

<style scoped>
.lead {
  border: none;
  padding: 0;
  margin: 0 0 14px;
}
.lead > span {
  display: block;
  font-weight: 600;
  margin-bottom: 4px;
}
.summary {
  background: var(--surface-2);
  border-radius: 6px;
  padding: 10px 12px;
  margin-bottom: 12px;
}
.coverage-warning {
  margin: 14px 0;
  padding: 13px 14px;
  background: var(--warn-soft);
  border: 1px solid #e5dec9;
  border-radius: 7px;
  font-size: 11.5px;
}
.coverage-warning p {
  margin: 3px 0 0;
  color: #64532b;
}
.tasks-head h2 {
  margin: 0;
}
.tasks-head .muted {
  margin-right: auto;
}
.section {
  margin-top: 12px;
}
.section h3 {
  text-transform: capitalize;
}
</style>
