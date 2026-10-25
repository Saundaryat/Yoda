<script setup lang="ts">
import type { Configuration } from '@evals/shared';
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import { useReviewNavigation } from '../composables/useReviewNavigation.js';
import { useResource } from '../composables/useResource.js';
import { dateTime } from '../format.js';
import { configurationName, configurationPurpose } from '../names.js';

const props = defineProps<{ id: string }>();
const {
  data: configuration,
  error,
  loading,
} = useResource<Configuration>(computed(() => `/configurations/${props.id}`));
const { backTo, backLabel, goBack } = useReviewNavigation('/configurations');
</script>

<template>
  <p v-if="error" class="error" role="alert">{{ error }}</p>
  <p v-else-if="loading" role="status">Loading configuration…</p>
  <template v-else-if="configuration">
    <div class="page-head">
      <div>
        <p class="subtitle">
          <a :href="backTo" @click="goBack">← {{ backLabel }}</a>
        </p>
        <p class="page-kicker">Saved agent version</p>
        <h1>{{ configurationName(configuration) }}</h1>
        <p v-if="configurationPurpose(configuration)" class="subtitle">
          {{ configurationPurpose(configuration) }}
        </p>
      </div>
      <RouterLink
        :to="{ path: '/configurations/new', query: { from: configuration.id } }"
        class="button"
        >Copy configuration</RouterLink
      >
    </div>
    <section class="card">
      <h2>Saved configuration</h2>
      <p>
        Read-only snapshot. Copy it to create a different version; past experiments keep this
        version.
      </p>
      <dl>
        <dt>Model</dt>
        <dd>{{ configuration.spec.model }} ({{ configuration.spec.provider }})</dd>
        <dt>Skills</dt>
        <dd>
          {{
            configuration.spec.skills.length
              ? `${configuration.spec.skills.join(', ')} · ${configuration.spec.skillMode === 'preloaded' ? 'always included' : 'on demand'}`
              : 'No skills'
          }}
        </dd>
        <dt>Memory</dt>
        <dd>{{ configuration.spec.memory.enabled ? 'on' : 'off' }}</dd>
        <dt>Reasoning</dt>
        <dd>{{ configuration.spec.reasoning || 'Provider default' }}</dd>
        <dt>Tools</dt>
        <dd>
          CRM{{
            configuration.spec.toolsets.length ? `, ${configuration.spec.toolsets.join(', ')}` : ''
          }}
          {{ configuration.spec.toolSearch ? ' · behind tool search' : ' · directly visible' }}
        </dd>
      </dl>
      <details class="metadata">
        <summary>Version details &amp; original name</summary>
        <dl>
          <dt>Original name</dt>
          <dd>{{ configuration.name }}</dd>
          <dt>Created</dt>
          <dd>{{ dateTime(configuration.createdAt) }}</dd>
          <dt>ID</dt>
          <dd class="mono">{{ configuration.id }}</dd>
          <dt>Version hash</dt>
          <dd class="mono">{{ configuration.specHash }}</dd>
        </dl>
      </details>
    </section>
    <section class="card">
      <h2>Instructions</h2>
      <pre>{{ configuration.spec.systemPrompt }}</pre>
    </section>
    <section class="card">
      <h2>Full configuration</h2>
      <p class="hint">Includes reasoning, tool search, seeded memory and all saved settings.</p>
      <details>
        <summary>View saved settings (JSON)</summary>
        <pre>{{ JSON.stringify(configuration.spec, null, 2) }}</pre>
      </details>
    </section>
  </template>
</template>

<style scoped>
dl {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 8px 16px;
}
dt {
  color: var(--muted);
}
dd {
  margin: 0;
  overflow-wrap: anywhere;
}
</style>
