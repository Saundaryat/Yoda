<script setup lang="ts">
import {
  MAX_VERSIONS,
  MIN_TASKS_FOR_VERDICT,
  versionLetter,
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
import { compareConfigurations, configurationName, groupName, taskName } from '../names.js';

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
const orderedConfigurations = computed(() =>
  [...(configurations.value ?? [])].sort(compareConfigurations),
);

const form = ref({
  name: '',
  hypothesis: '',
  /** Baseline first, then every candidate. */
  configIds: ['', ''] as string[],
  repetitions: 3,
  leadMode: 'scripted' as LeadMode,
});
const selected = ref(new Set<string>());
const error = ref<string | null>(null);
const saving = ref(false);

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

const runCount = computed(
  () => selected.value.size * form.value.configIds.length * form.value.repetitions,
);

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
    form.value.configIds.every(Boolean) &&
    new Set(form.value.configIds).size === form.value.configIds.length &&
    selected.value.size > 0 &&
    Number.isInteger(form.value.repetitions) &&
    form.value.repetitions >= 1 &&
    form.value.repetitions <= 10,
);
const config = (id: string) => configurations.value?.find((c) => c.id === id);
/** For each chosen candidate, the settings that differ from the baseline (A). */
const differences = computed(() => {
  const baseline = config(form.value.configIds[0] ?? '');
  if (!baseline) return [];
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
  return form.value.configIds.slice(1).flatMap((id, index) => {
    const candidate = config(id);
    if (!candidate) return [];
    const differing = Object.entries(fields)
      .filter(
        ([key]) =>
          JSON.stringify(baseline.spec[key as keyof typeof fields]) !==
          JSON.stringify(candidate.spec[key as keyof typeof fields]),
      )
      .map(([, label]) => label);
    return [{ letter: versionLetter(index + 1), differing }];
  });
});

async function create() {
  if (!valid.value || saving.value) return;
  saving.value = true;
  error.value = null;
  try {
    const body: CreateExperiment = {
      name: form.value.name.trim(),
      hypothesis: form.value.hypothesis,
      configIds: [...form.value.configIds],
      repetitions: form.value.repetitions,
      leadMode: form.value.leadMode,
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
      <h2 class="setup-section">
        <span class="setup-step">2</span> Choose the versions to compare
      </h2>
      <p class="panel-caption">
        Keep the model and other settings the same when testing one change. Add up to
        {{ MAX_VERSIONS }} versions to rank several changes in one run.
      </p>
      <div v-for="(_, index) in form.configIds" :key="index" class="field">
        <label :for="`version-${index}`" :class="index === 0 ? 'side-a' : 'side-b'"
          >{{ versionLetter(index) }} — {{ index === 0 ? 'baseline' : 'candidate' }}</label
        >
        <div class="version-row">
          <select :id="`version-${index}`" v-model="form.configIds[index]" required>
            <option value="" disabled>Choose a configuration</option>
            <option
              v-for="c in orderedConfigurations"
              :key="c.id"
              :value="c.id"
              :disabled="form.configIds.some((other, i) => i !== index && other === c.id)"
            >
              {{ configurationName(c) }}
            </option>
          </select>
          <button
            v-if="index >= 2"
            type="button"
            class="text-action"
            :aria-label="`Remove version ${versionLetter(index)}`"
            @click="form.configIds.splice(index, 1)"
          >
            Remove
          </button>
        </div>
        <small>{{
          index === 0
            ? 'The starting version you want to compare against.'
            : index === 1
              ? 'The version containing your proposed change.'
              : 'Another version, ranked against the others and compared with A.'
        }}</small>
      </div>
      <button
        v-if="form.configIds.length < MAX_VERSIONS"
        type="button"
        class="text-action add-version"
        @click="form.configIds.push('')"
      >
        + Add version {{ versionLetter(form.configIds.length) }}
      </button>
      <div v-for="d in differences" :key="d.letter" class="setup-note">
        <span v-if="differences.length > 1" class="muted">{{ d.letter }} vs A</span>
        <strong>{{
          d.differing.length ? 'Settings that differ' : 'Identical settings (A/A control)'
        }}</strong>
        <p>
          {{
            d.differing.length
              ? d.differing.join(' · ')
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
        <div v-for="(configId, index) in form.configIds" :key="index">
          <span class="muted"
            >{{ versionLetter(index) }} ·
            {{ index === 0 ? 'Starting version' : 'Proposed version' }}</span
          ><strong>{{
            config(configId)
              ? configurationName(config(configId))
              : index === 0
                ? 'Choose a baseline'
                : 'Choose a candidate'
          }}</strong>
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
          <strong>{{ runCount }}</strong> runs ({{ selected.size }} tasks ×
          {{ form.configIds.length }} versions × {{ form.repetitions }})
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
.version-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.version-row select {
  flex: 1;
}
.add-version {
  align-self: flex-start;
  margin-bottom: 12px;
}
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
