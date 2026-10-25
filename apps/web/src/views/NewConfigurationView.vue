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
  <div class="page-head configuration-heading">
    <div>
      <p class="back-link"><RouterLink to="/configurations">← Agent versions</RouterLink></p>
      <p class="page-kicker">Define an agent version</p>
      <h1>New configuration</h1>
      <p class="subtitle">Set up the agent, choose its capabilities, then review and save.</p>
    </div>
  </div>
  <p v-if="sourceLoading" class="card">Loading the original version…</p>
  <p v-else-if="sourceError" class="error" role="alert">
    Could not load the original version: {{ sourceError }}
  </p>
  <form v-else class="card setup-form configuration-form" @submit.prevent="save">
    <section class="configuration-step" aria-labelledby="configuration-name-title">
      <header class="step-heading">
        <h2 id="configuration-name-title">
          <span class="setup-step" aria-hidden="true">1</span> Name the version
        </h2>
        <p>Give this version a clear name.</p>
      </header>
      <div class="step-fields">
        <p v-if="source" class="copy-notice">
          Copying {{ configurationName(source) }}. The original stays unchanged.
        </p>
        <div class="setup-two">
          <label class="field"
            ><span>Name</span
            ><input v-model="form.name" placeholder="e.g. Booking with clinic policy" required
          /></label>
          <label class="field"
            ><span>Description <span class="optional">Optional</span></span
            ><input v-model="form.description" placeholder="What changed in this version?"
          /></label>
        </div>
      </div>
    </section>

    <section class="configuration-step" aria-labelledby="configuration-model-title">
      <header class="step-heading">
        <h2 id="configuration-model-title">
          <span class="setup-step" aria-hidden="true">2</span> Model & instructions
        </h2>
        <p>Set the model and how it should behave.</p>
      </header>
      <div class="step-fields">
        <div class="model-fields">
          <label class="field"
            ><span>Provider</span
            ><select v-model="form.provider">
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
            </select></label
          >
          <label class="field"
            ><span>Model</span
            ><input
              v-model="form.model"
              :placeholder="
                form.provider === 'anthropic' ? 'e.g. claude-haiku-4-5' : 'e.g. gpt-4.1-mini'
              "
              required
          /></label>
          <label class="field"
            ><span>Reasoning</span
            ><select v-model="form.reasoning">
              <option value="">Provider default</option>
              <option value="none">none</option>
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
            </select></label
          >
        </div>
        <p class="field-guidance">
          Use the provider’s exact model ID. Reasoning applies only to models that support it.
        </p>
        <label class="field">
          <span>Instructions</span>
          <textarea
            v-model="form.systemPrompt"
            aria-label="Instructions"
            aria-describedby="instructions-help"
            rows="7"
            placeholder="Describe the agent’s role, reply style and rules for using CRM tools."
            required
          />
          <small id="instructions-help"
            >Keep the model unchanged when testing a change to these instructions or the clinic
            policy.</small
          >
        </label>
      </div>
    </section>

    <section class="configuration-step" aria-labelledby="configuration-skills-title">
      <header class="step-heading">
        <h2 id="configuration-skills-title">
          <span class="setup-step" aria-hidden="true">3</span> Policy & skills
        </h2>
        <p>Choose the knowledge it can use.</p>
      </header>
      <div class="step-fields">
        <p v-if="skillsError" class="error" role="alert">
          Could not load optional skills: {{ skillsError }}. Existing selections are preserved.
        </p>
        <p v-else-if="!skills" class="muted" role="status">Loading available skills…</p>
        <p v-if="skills && !skills.length" class="field-guidance">
          No skills are available in this workspace.
        </p>
        <label v-for="skill in skills" :key="skill.name" class="check choice-row">
          <input v-model="form.skills" type="checkbox" :value="skill.name" />
          <span
            ><strong>{{ skill.name }}</strong
            ><small>{{ skill.description }}</small></span
          >
        </label>
        <fieldset v-if="form.skills.length" class="skill-mode">
          <legend>How to include selected skills</legend>
          <div class="setup-two">
            <label class="check mode-choice"
              ><input v-model="form.skillMode" type="radio" value="available" /><span
                ><strong>On demand</strong><small>The agent chooses when to open them.</small></span
              ></label
            >
            <label class="check mode-choice"
              ><input v-model="form.skillMode" type="radio" value="preloaded" /><span
                ><strong>Always included</strong
                ><small>Full instructions in every conversation.</small></span
              ></label
            >
          </div>
        </fieldset>
      </div>
    </section>

    <section class="configuration-step" aria-labelledby="configuration-memory-title">
      <header class="step-heading">
        <h2 id="configuration-memory-title">
          <span class="setup-step" aria-hidden="true">4</span> Memory & tools
        </h2>
        <p>Control what it remembers and can do.</p>
      </header>
      <div class="step-fields">
        <label class="check choice-row">
          <input v-model="form.memoryEnabled" type="checkbox" />
          <span
            ><strong>Enable memory</strong
            ><small
              >Retain notes between conversations within a run. Each run has its own isolated
              memory.</small
            ></span
          >
        </label>
        <label v-if="form.memoryEnabled" class="field"
          ><span>Seed notes (optional, one per line)</span
          ><textarea
            v-model="form.memorySeed"
            rows="3"
            placeholder="Add any notes the agent should start with."
          />
        </label>
        <p class="included-tools">
          <span aria-hidden="true">✓</span
          ><span
            ><strong>CRM tools included</strong
            ><small>Look up customers, find slots and manage bookings.</small></span
          >
        </p>
        <details class="tool-options">
          <summary>Advanced tool settings</summary>
          <div class="advanced-fields">
            <fieldset class="skill-mode">
              <legend>Additional toolsets</legend>
              <div class="setup-two">
                <label v-for="toolset in OPTIONAL_TOOLSETS" :key="toolset" class="check"
                  ><input v-model="form.toolsets" type="checkbox" :value="toolset" /><span
                    class="mono"
                    >{{ toolset }}</span
                  ></label
                >
              </div>
            </fieldset>
            <label class="check"
              ><input v-model="form.toolSearch" type="checkbox" /><span
                ><strong>Discover CRM tools through tool search</strong
                ><small>Keep off to make CRM tools directly available to the agent.</small></span
              ></label
            >
          </div>
        </details>
      </div>
    </section>

    <section class="configuration-step configuration-review" aria-label="Configuration review">
      <header class="step-heading">
        <h2 id="configuration-review-title">
          <span class="setup-step" aria-hidden="true">5</span> Review & save
        </h2>
        <p>Check your choices before saving.</p>
      </header>
      <div class="step-fields">
        <div class="setup-review-grid">
          <div>
            <span class="muted">Model</span><strong>{{ form.model || 'Enter a model' }}</strong
            ><small
              >{{ form.provider }} ·
              {{ form.reasoning ? `${form.reasoning} reasoning` : 'Default reasoning' }}</small
            >
          </div>
          <div>
            <span class="muted">Skills</span
            ><strong>{{
              form.skills.length ? form.skills.join(', ') : 'No skills selected'
            }}</strong
            ><small v-if="form.skills.length">{{
              form.skillMode === 'preloaded'
                ? 'Always included in the prompt'
                : 'Available for the agent to open'
            }}</small>
          </div>
          <div>
            <span class="muted">Memory & tools</span
            ><strong>Memory {{ form.memoryEnabled ? 'on' : 'off' }} · CRM included</strong
            ><small>{{ form.toolSearch ? 'CRM behind tool search' : 'CRM directly visible' }}</small
            ><small v-if="form.toolsets.length"
              >Additional tools: {{ form.toolsets.join(', ') }}</small
            >
          </div>
        </div>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <div class="configuration-actions">
          <p>Creates a new version.<br />No model calls when saving.</p>
          <div>
            <RouterLink to="/configurations" class="button">Cancel</RouterLink
            ><button class="primary" type="submit" :disabled="!valid || saving">
              {{ saving ? 'Saving…' : 'Save configuration' }}
            </button>
          </div>
        </div>
      </div>
    </section>
  </form>
</template>

<style scoped>
.configuration-heading,
.configuration-form {
  max-width: 1120px;
  margin-left: auto;
  margin-right: auto;
}
.back-link {
  margin: 0 0 16px;
  font-size: 12px;
}
.configuration-form {
  display: block;
  padding: 0;
}
.configuration-step {
  display: grid;
  grid-template-columns: 210px minmax(0, 1fr);
  align-items: start;
  gap: 28px;
  padding: 24px 28px;
}
.configuration-step + .configuration-step {
  border-top: 1px solid var(--border);
}
.step-heading h2 {
  margin: 0;
  align-items: flex-start;
  font-size: 15px;
}
.step-heading .setup-step {
  margin-top: -2px;
}
.step-heading p {
  margin: 8px 0 0 37px;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--muted);
}
.step-fields {
  display: grid;
  gap: 16px;
  min-width: 0;
}
.configuration-form .field,
.configuration-form .check {
  margin: 0;
}
.configuration-form .field {
  min-width: 0;
}
.configuration-form .field > span {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.configuration-form .check {
  padding: 0;
}
.configuration-form .setup-two {
  gap: 14px;
}
.model-fields {
  display: grid;
  grid-template-columns: minmax(0, 0.85fr) minmax(0, 1.3fr) minmax(0, 1fr);
  gap: 14px;
}
.optional {
  color: var(--muted);
  font-size: 10.5px;
  font-weight: 400;
}
.copy-notice,
.field-guidance {
  margin: 0;
  font-size: 11px;
  line-height: 1.6;
  color: var(--muted);
}
.copy-notice {
  padding: 10px 12px;
  border-radius: 6px;
  background: var(--surface-2);
}
.field-guidance {
  margin-top: -7px;
}
.configuration-form .choice-row,
.configuration-form .mode-choice {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
}
.choice-row > span,
.mode-choice > span {
  min-width: 0;
}
.configuration-form .check strong {
  font-size: 12px;
  font-weight: 600;
}
.configuration-form .check small,
.included-tools small {
  display: block;
  margin-top: 3px;
  color: var(--muted);
  font-size: 11px;
  line-height: 1.6;
}
.skill-mode {
  border: 0;
  padding: 0;
  margin: 0;
}
.configuration-form .skill-mode legend {
  margin-bottom: 10px;
  font-size: 11px;
}
.included-tools {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin: 0;
  font-size: 12px;
}
.included-tools > span:first-child {
  color: var(--muted);
}
.tool-options {
  border-top: 1px solid var(--border);
  padding-top: 14px;
}
.tool-options summary {
  font-size: 12px;
  font-weight: 600;
}
.advanced-fields {
  display: grid;
  gap: 18px;
  padding-top: 16px;
}
.configuration-review {
  background: #fafafa;
  border-radius: 0 0 12px 12px;
}
.configuration-form .setup-review-grid {
  margin: 0;
  gap: 16px;
  font-size: 11px;
}
.configuration-form .setup-review-grid strong {
  font-size: 12px;
}
.configuration-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  border-top: 1px solid var(--border);
  padding-top: 16px;
}
.configuration-actions p {
  margin: 0;
  color: var(--muted);
  font-size: 11px;
  line-height: 1.6;
}
.configuration-actions > div {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
@media (max-width: 800px) {
  .configuration-step {
    grid-template-columns: minmax(0, 1fr);
    gap: 18px;
    padding: 22px;
  }
  .step-heading p {
    margin-top: 4px;
  }
}
@media (max-width: 600px) {
  .configuration-step {
    padding: 20px 16px;
  }
  .configuration-form .setup-two,
  .model-fields {
    grid-template-columns: minmax(0, 1fr);
    gap: 14px;
  }
  .configuration-actions {
    flex-direction: column;
    align-items: stretch;
  }
  .configuration-actions > div {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }
  .configuration-actions > div > * {
    text-align: center;
  }
}
</style>
