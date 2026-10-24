<script setup lang="ts">
import type { Configuration, CreateExperiment, ExperimentSummary, LeadMode } from '@evals/shared';
import { computed, ref, watch } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { api } from '../api.js';
import { useResource } from '../composables/useResource.js';
import { money } from '../format.js';

interface TaskItem {
  id: string;
  key: string;
  title: string;
  split: 'dev' | 'eval';
  group: string;
  family: string;
}

const router = useRouter();
const { data: tasks } = useResource<TaskItem[]>('/tasks');
const { data: configurations } = useResource<Configuration[]>('/configurations');
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

// Default to the frozen eval split when it exists, otherwise the dev split.
watch(tasks, (list) => {
  if (!list || selected.value.size) return;
  const split = list.some((t) => t.split === 'eval') ? 'eval' : 'dev';
  selected.value = new Set(list.filter((t) => t.split === split).map((t) => t.id));
});

const sections = computed(() => {
  const groups = new Map<string, TaskItem[]>();
  for (const task of tasks.value ?? []) {
    const key = `${task.split} · ${task.group}`;
    groups.set(key, [...(groups.get(key) ?? []), task]);
  }
  return [...groups.entries()];
});

function toggle(id: string) {
  const next = new Set(selected.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selected.value = next;
}

function selectSplit(split: 'dev' | 'eval') {
  selected.value = new Set((tasks.value ?? []).filter((t) => t.split === split).map((t) => t.id));
}

const runCount = computed(() => selected.value.size * 2 * form.value.repetitions);

/** Average cost per scored run in earlier experiments: a rough guide, not a quote. */
const costPerRun = computed(() => {
  const past = (history.value ?? []).filter((e) => e.counts.scored > 0 && e.costUsd > 0);
  const runs = past.reduce((s, e) => s + e.counts.scored, 0);
  return runs ? past.reduce((s, e) => s + e.costUsd, 0) / runs : null;
});

const valid = computed(
  () =>
    form.value.name.trim() &&
    form.value.baselineConfigId &&
    form.value.candidateConfigId &&
    form.value.baselineConfigId !== form.value.candidateConfigId &&
    selected.value.size > 0,
);

async function create() {
  saving.value = true;
  error.value = null;
  try {
    const body: CreateExperiment = { ...form.value, taskIds: [...selected.value] };
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
      <h1>New experiment</h1>
      <p class="subtitle">
        Creating the experiment makes no model calls. You start it on the next page.
      </p>
    </div>
  </div>

  <div v-if="configurations && configurations.length < 2" class="card">
    You need two configurations to compare.
    <RouterLink to="/configurations/new">Create a configuration</RouterLink>.
  </div>

  <form v-else class="grid-2" @submit.prevent="create">
    <div class="card">
      <label class="field">
        <span>Name</span>
        <input v-model="form.name" placeholder="Clinic skill vs baseline" required />
      </label>
      <label class="field">
        <span>Hypothesis</span>
        <textarea
          v-model="form.hypothesis"
          placeholder="What do you expect, written before the results? e.g. The skill helps the policy tasks; controls stay flat."
        />
      </label>
      <label class="field">
        <span class="side-a">A — baseline</span>
        <select v-model="form.baselineConfigId" required>
          <option value="" disabled>Choose a configuration</option>
          <option v-for="c in configurations" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
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
            {{ c.name }}
          </option>
        </select>
      </label>
      <label class="field">
        <span>Repetitions per task and configuration</span>
        <input v-model.number="form.repetitions" type="number" min="1" max="10" />
        <small>Agents are not deterministic. 3 repetitions show how consistent each one is.</small>
      </label>
      <fieldset class="field lead">
        <span>Who plays the lead</span>
        <label class="check">
          <input v-model="form.leadMode" type="radio" value="scripted" />
          <span>
            <strong>Scripted</strong> — the task's rules. Identical for A and B, free, best for a
            fair comparison.
          </span>
        </label>
        <label class="check">
          <input v-model="form.leadMode" type="radio" value="llm" />
          <span>
            <strong>LLM (Claude)</strong> — plays the lead from a persona: realistic, varied
            wording. Needs <span class="mono">ANTHROPIC_API_KEY</span>; adds a little cost per turn.
          </span>
        </label>
      </fieldset>

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
              : 'unknown until the first experiment'
          }}
        </div>
      </div>
      <p v-if="error" class="error">{{ error }}</p>
      <button class="primary" type="submit" :disabled="!valid || saving">Create experiment</button>
    </div>

    <div class="card">
      <div class="row tasks-head">
        <h2>Tasks</h2>
        <span class="muted">{{ selected.size }} selected</span>
        <button type="button" @click="selectSplit('eval')">All eval</button>
        <button type="button" @click="selectSplit('dev')">All dev</button>
      </div>
      <p class="hint">
        Use the dev split while tuning tasks and prompts; keep the eval split for real comparisons.
      </p>
      <div v-for="[section, items] in sections" :key="section" class="section">
        <h3>{{ section }}</h3>
        <label v-for="task in items" :key="task.id" class="check">
          <input type="checkbox" :checked="selected.has(task.id)" @change="toggle(task.id)" />
          <span>
            {{ task.title }}
            <span class="muted mono">{{ task.key }}</span>
          </span>
        </label>
      </div>
    </div>
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
