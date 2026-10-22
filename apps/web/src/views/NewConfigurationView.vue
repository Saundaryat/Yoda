<script setup lang="ts">
import { OPTIONAL_TOOLSETS, type Configuration, type CreateConfiguration } from '@evals/shared';
import { ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api.js';
import { useResource } from '../composables/useResource.js';

interface Skill {
  name: string;
  description: string;
  content: string;
}

const route = useRoute();
const router = useRouter();
const { data: skills } = useResource<Skill[]>('/skills');
const from = typeof route.query.from === 'string' ? route.query.from : null;
const { data: source } = useResource<Configuration>(() =>
  from ? `/configurations/${from}` : null,
);

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
    name: `${c.name} (copy)`,
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

async function save() {
  saving.value = true;
  error.value = null;
  const f = form.value;
  const body: CreateConfiguration = {
    name: f.name,
    description: f.description,
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
      <h1>New configuration</h1>
      <p class="subtitle">
        Change one thing at a time against a baseline, so a difference has one cause.
      </p>
    </div>
  </div>
  <form class="grid-2" @submit.prevent="save">
    <div class="card">
      <label class="field"><span>Name</span><input v-model="form.name" required /></label>
      <label class="field"><span>Description</span><input v-model="form.description" /></label>
      <div class="row two">
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
        <label class="field">
          <span>Reasoning</span>
          <select v-model="form.reasoning">
            <option value="">Provider default</option>
            <option value="none">none</option>
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </select>
        </label>
      </div>
      <label class="field">
        <span>Instructions</span>
        <textarea v-model="form.systemPrompt" rows="10" required />
        <small>Written to Hermes's SOUL.md, the first part of its system prompt.</small>
      </label>
    </div>

    <div class="card">
      <h2>Skills</h2>
      <label v-for="skill in skills" :key="skill.name" class="check">
        <input v-model="form.skills" type="checkbox" :value="skill.name" />
        <span
          ><strong>{{ skill.name }}</strong>
          <span class="muted">— {{ skill.description }}</span></span
        >
      </label>
      <div v-if="form.skills.length" class="row mode">
        <label class="check"
          ><input v-model="form.skillMode" type="radio" value="available" /> Available: listed, the
          agent decides to open it</label
        >
        <label class="check"
          ><input v-model="form.skillMode" type="radio" value="preloaded" /> Preloaded: full text in
          the prompt</label
        >
      </div>

      <h2 class="spaced">Memory</h2>
      <label class="check">
        <input v-model="form.memoryEnabled" type="checkbox" />
        <span>Hermes memory on (MEMORY.md / USER.md and the memory tool)</span>
      </label>
      <label v-if="form.memoryEnabled" class="field">
        <span>Seed notes (optional, one per line)</span>
        <textarea v-model="form.memorySeed" rows="4" />
      </label>

      <h2 class="spaced">Tools</h2>
      <p class="hint">The CRM tools are always on.</p>
      <label v-for="toolset in OPTIONAL_TOOLSETS" :key="toolset" class="check">
        <input v-model="form.toolsets" type="checkbox" :value="toolset" />
        <span class="mono">{{ toolset }}</span>
      </label>
      <label class="check">
        <input v-model="form.toolSearch" type="checkbox" />
        <span>Tool search: hide CRM tools behind Hermes's tool_search bridge</span>
      </label>

      <p v-if="error" class="error">{{ error }}</p>
      <button class="primary" type="submit" :disabled="saving">Save configuration</button>
    </div>
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
