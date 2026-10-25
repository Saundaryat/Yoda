<script setup lang="ts">
import { OPTIONAL_TOOLSETS, type Configuration, type CreateConfiguration } from '@evals/shared';
import { computed, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { api } from '../api.js';
import { useResource } from '../composables/useResource.js';
import { configurationName } from '../names.js';

interface Skill {
  name: string;
  description: string;
  content: string;
}

const route = useRoute();
const router = useRouter();
const { data: skills, error: skillsError } = useResource<Skill[]>('/skills');
const from = typeof route.query.from === 'string' ? route.query.from : null;
const {
  data: source,
  error: sourceError,
  loading: sourceLoading,
} = useResource<Configuration>(() => (from ? `/configurations/${from}` : null));

const form = ref({
  name: '',
  description: '',
  provider: 'openai' as 'openai' | 'anthropic',
  model: '',
  reasoning: '' as '' | 'none' | 'low' | 'medium' | 'high',
  systemPrompt: '',
  skills: [] as string[],
  skillMode: 'available' as 'available' | 'preloaded',
  memoryEnabled: false,
  memorySeed: '',
  toolsets: [] as string[],
  toolSearch: false,
});

watch(source, (c) => {
  if (!c) return;
  form.value = {
    name: `${configurationName(c)} (copy)`,
    description: c.description,
    provider: c.spec.provider,
    model: c.spec.model,
    reasoning: c.spec.reasoning ?? '',
    systemPrompt: c.spec.systemPrompt,
    skills: [...c.spec.skills],
    skillMode: c.spec.skillMode,
    memoryEnabled: c.spec.memory.enabled,
    memorySeed: c.spec.memory.seed.join('\n'),
    toolsets: [...c.spec.toolsets],
    toolSearch: c.spec.toolSearch,
  };
});

const error = ref<string | null>(null);
const saving = ref(false);
const valid = computed(
  () =>
    form.value.name.trim() &&
    form.value.model.trim() &&
    form.value.systemPrompt.trim() &&
    (!from || source.value),
);

async function save() {
  if (!valid.value || saving.value) return;
  saving.value = true;
  error.value = null;
  const f = form.value;
  const body: CreateConfiguration = {
    name: f.name.trim(),
    description: f.description.trim(),
    spec: {
      provider: f.provider,
      model: f.model.trim(),
      ...(f.reasoning && { reasoning: f.reasoning }),
      systemPrompt: f.systemPrompt,
      skills: f.skills,
      skillMode: f.skillMode,
      memory: {
        enabled: f.memoryEnabled,
        seed: f.memoryEnabled
          ? f.memorySeed
              .split('\n')
              .map((s) => s.trim())
              .filter(Boolean)
          : [],
      },
      toolsets: f.toolsets as CreateConfiguration['spec']['toolsets'],
      toolSearch: f.toolSearch,
    },
  };
  try {
    await api('/configurations', { method: 'POST', body: JSON.stringify(body) });
    await router.push('/configurations');
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
      <p class="subtitle"><RouterLink to="/configurations">← Agent versions</RouterLink></p>
      <p class="page-kicker">Define an agent version</p>
      <h1>New configuration</h1>
      <p class="subtitle">
        Choose how Hermes behaves. Save a new version without changing any previous results.
      </p>
    </div>
  </div>
  <p v-if="sourceLoading" class="card">Loading the original version…</p>
  <p v-else-if="sourceError" class="error" role="alert">
    Could not load the original version: {{ sourceError }}
  </p>
  <form v-else class="setup-form" @submit.prevent="save">
    <div class="card">
      <h2><span class="setup-step">1</span> Name the version</h2>
      <p v-if="source" class="setup-note">
        Copying {{ configurationName(source) }}. The original stays unchanged.
      </p>
      <p v-else class="panel-caption">
        Use a name that explains the change, such as “Clinic policy always included”.
      </p>
      <label class="field"><span>Name</span><input v-model="form.name" required /></label>
      <label class="field"><span>Description</span><input v-model="form.description" /></label>
      <h2 class="setup-section"><span class="setup-step">2</span> Model & instructions</h2>
      <div class="setup-two">
        <label class="field">
          <span>Provider</span>
          <select v-model="form.provider">
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
          </select>
        </label>
        <label class="field">
          <span>Model</span>
          <input v-model="form.model" placeholder="e.g. gpt-4.1-mini" required />
        </label>
      </div>
      <p class="hint">
        Use the provider’s exact model identifier. Keep the model unchanged when testing a policy or
        prompt change.
      </p>
      <label class="field">
        <span>Instructions</span>
        <textarea
          v-model="form.systemPrompt"
          aria-label="Instructions"
          aria-describedby="instructions-help"
          rows="12"
          placeholder="Describe the assistant’s role, customer-facing response style, and rules for using CRM tools."
          required
        />
        <small id="instructions-help"
          >Written to Hermes's SOUL.md, the first part of its system prompt.</small
        >
      </label>
    </div>

    <div class="card">
      <h2><span class="setup-step">3</span> Add policy & skills</h2>
      <p v-if="skillsError" class="error" role="alert">
        Could not load optional skills: {{ skillsError }}. Existing selections are preserved.
      </p>
      <p v-else-if="!skills" class="muted" role="status">Loading available skills…</p>
      <p class="panel-caption">
        Optional knowledge for Hermes. Choose whether it must discover the skill or receives it
        every time.
      </p>
      <p v-if="skills && !skills.length" class="hint">No skills are available in this workspace.</p>
      <label v-for="skill in skills" :key="skill.name" class="check">
        <input v-model="form.skills" type="checkbox" :value="skill.name" />
        <span
          ><strong>{{ skill.name }}</strong>
          <span class="muted">— {{ skill.description }}</span></span
        >
      </label>
      <div v-if="form.skills.length" class="setup-note">
        <label class="check"
          ><input v-model="form.skillMode" type="radio" value="available" /> Available: listed, the
          agent decides to open it</label
        >
        <label class="check"
          ><input v-model="form.skillMode" type="radio" value="preloaded" /> Preloaded: full text in
          the prompt</label
        >
      </div>

      <h2 class="setup-section"><span class="setup-step">4</span> Memory & tools</h2>
      <p class="panel-caption">
        Memory belongs to each run’s isolated Hermes home, not to other experiment runs.
      </p>
      <label class="check">
        <input v-model="form.memoryEnabled" type="checkbox" />
        <span>Hermes memory on (MEMORY.md / USER.md and the memory tool)</span>
      </label>
      <label v-if="form.memoryEnabled" class="field">
        <span>Seed notes (optional, one per line)</span>
        <textarea v-model="form.memorySeed" rows="4" />
      </label>

      <div class="setup-note">
        <strong>CRM tools are always included</strong>
        <p>Hermes can look up leads, find slots and act on the mock CRM.</p>
      </div>
      <details class="setup-advanced">
        <summary>Advanced settings · tools & reasoning</summary>
        <label class="field"
          ><span>Reasoning</span
          ><select v-model="form.reasoning">
            <option value="">Provider default</option>
            <option value="none">none</option>
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option></select
          ><small>Only used by models that support this setting.</small></label
        >
        <p class="hint">Optional Hermes toolsets</p>
        <label v-for="toolset in OPTIONAL_TOOLSETS" :key="toolset" class="check">
          <input v-model="form.toolsets" type="checkbox" :value="toolset" />
          <span class="mono">{{ toolset }}</span>
        </label>
        <label class="check">
          <input v-model="form.toolSearch" type="checkbox" />
          <span>Tool search: hide CRM tools behind Hermes's tool_search bridge</span>
        </label>
        <p class="hint">With tool search off, CRM tools are directly visible to the agent.</p>
      </details>
    </div>
    <section class="card setup-review" aria-label="Configuration review">
      <h2><span class="setup-step">5</span> Review this version</h2>
      <div class="setup-review-grid">
        <div>
          <span class="muted">Model</span><strong>{{ form.model || 'Enter a model' }}</strong
          ><small>{{ form.provider }}</small>
        </div>
        <div>
          <span class="muted">Skills</span
          ><strong>{{ form.skills.length ? form.skills.join(', ') : 'No skills selected' }}</strong
          ><small v-if="form.skills.length">{{
            form.skillMode === 'preloaded'
              ? 'Always included in the prompt'
              : 'Available for the agent to open'
          }}</small>
        </div>
        <div>
          <span class="muted">Memory & tools</span
          ><strong>Memory {{ form.memoryEnabled ? 'on' : 'off' }} · CRM included</strong
          ><small>{{ form.toolSearch ? 'CRM behind tool search' : 'CRM directly visible' }}</small>
        </div>
      </div>
      <p v-if="error" class="error">{{ error }}</p>
      <div class="setup-actions">
        <p class="muted">Saving makes no model calls. Use this version in a new A/B experiment.</p>
        <button class="primary" type="submit" :disabled="!valid || saving">
          {{ saving ? 'Saving…' : 'Save configuration' }}
        </button>
      </div>
    </section>
  </form>
</template>

<style scoped>
.two {
  align-items: flex-start;
  flex-wrap: nowrap;
}
.two .field {
  flex: 1;
}
.mode {
  flex-direction: column;
  align-items: flex-start;
  margin: 8px 0 0 4px;
}
.spaced {
  margin-top: 20px;
}
</style>
