<script setup lang="ts">
import type { Configuration } from '@evals/shared';
import { RouterLink } from 'vue-router';
import { useResource } from '../composables/useResource.js';
import { dateTime } from '../format.js';

const { data: configurations, error } = useResource<Configuration[]>('/configurations');
</script>

<template>
  <div class="page-head">
    <div>
      <h1>Configurations</h1>
      <p class="subtitle">
        A configuration is everything about the agent that an experiment can change: model,
        instructions, skills, memory and tools. Saved configurations never change, so old results
        stay explainable.
      </p>
    </div>
    <RouterLink to="/configurations/new" class="button primary">New configuration</RouterLink>
  </div>
  <p v-if="error" class="error">{{ error }}</p>
  <div v-else-if="configurations && !configurations.length" class="card empty">
    No configurations yet.
  </div>
  <div class="cards">
    <article v-for="c in configurations" :key="c.id" class="card">
      <div class="row head">
        <h2>{{ c.name }}</h2>
        <RouterLink :to="{ path: '/configurations/new', query: { from: c.id } }">Copy</RouterLink>
      </div>
      <p v-if="c.description" class="muted">{{ c.description }}</p>
      <dl>
        <dt>Model</dt>
        <dd>
          {{ c.spec.model }}
          <span class="muted"
            >({{ c.spec.provider
            }}{{ c.spec.reasoning ? `, reasoning ${c.spec.reasoning}` : '' }})</span
          >
        </dd>
        <dt>Skills</dt>
        <dd>
          {{ c.spec.skills.length ? `${c.spec.skills.join(', ')} — ${c.spec.skillMode}` : 'none' }}
        </dd>
        <dt>Memory</dt>
        <dd>
          {{
            c.spec.memory.enabled
              ? `on${c.spec.memory.seed.length ? `, ${c.spec.memory.seed.length} seeded notes` : ''}`
              : 'off'
          }}
        </dd>
        <dt>Tools</dt>
        <dd>
          CRM{{ c.spec.toolsets.length ? `, ${c.spec.toolsets.join(', ')}` : ''
          }}{{ c.spec.toolSearch ? ' (behind tool search)' : '' }}
        </dd>
      </dl>
      <details>
        <summary>Instructions</summary>
        <pre>{{ c.spec.systemPrompt }}</pre>
      </details>
      <p class="hint">
        Created {{ dateTime(c.createdAt) }} · <span class="mono">{{ c.specHash.slice(0, 8) }}</span>
      </p>
    </article>
  </div>
</template>

<style scoped>
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 16px;
}
.cards .card {
  margin: 0;
}
.head h2 {
  margin: 0 auto 0 0;
}
dl {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 4px 12px;
  margin: 12px 0;
}
dt {
  color: var(--muted);
}
dd {
  margin: 0;
}
summary {
  cursor: pointer;
  color: var(--muted);
  margin-bottom: 6px;
}
</style>
