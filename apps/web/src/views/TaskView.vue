<script setup lang="ts">
import type { TaskDefinition } from '@evals/shared';
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import { useResource } from '../composables/useResource.js';

interface TaskRow {
  id: string;
  key: string;
  suite: string;
  split: string;
  versionHash: string;
  definition: TaskDefinition;
}

const props = defineProps<{ id: string }>();
const { data, error } = useResource<TaskRow>(computed(() => `/tasks/${props.id}`));
const d = computed(() => data.value?.definition);

const describeCheck = (check: TaskDefinition['checks'][number]) => {
  const { id: _id, label: _label, weight: _w, critical: _c, type: _t, ...rest } = check;
  return JSON.stringify(rest);
};
</script>

<template>
  <p v-if="error" class="error">{{ error }}</p>
  <template v-else-if="data && d">
    <div class="page-head">
      <div>
        <p class="subtitle"><RouterLink to="/tasks">← Tasks</RouterLink></p>
        <h1>{{ d.title }}</h1>
        <p class="subtitle">
          <span class="mono">{{ data.suite }}/{{ data.split }}/{{ data.key }}.yaml</span> · group
          {{ d.group }} · family {{ d.family }} · version {{ data.versionHash.slice(0, 8) }}
        </p>
      </div>
    </div>
    <p v-if="d.description" class="card">{{ d.description }}</p>

    <section class="card">
      <h2>How it is scored</h2>
      <p class="hint">
        Score = weighted share of checks passed. The run passes when every critical check passes and
        the score is at least {{ d.passThreshold }}.
      </p>
      <table>
        <thead>
          <tr>
            <th>Check</th>
            <th>Type</th>
            <th class="num">Weight</th>
            <th>Rule</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="check in d.checks" :key="check.id">
            <td>
              {{ check.label }} <span v-if="check.critical" class="badge warn">critical</span>
            </td>
            <td class="mono">{{ check.type }}</td>
            <td class="num">{{ check.weight }}</td>
            <td class="mono">{{ describeCheck(check) }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section v-for="(session, i) in d.sessions" :key="i" class="card">
      <h2>Scripted lead{{ d.sessions.length > 1 ? `, session ${i + 1}` : '' }}</h2>
      <p><strong>Opens with:</strong> “{{ session.opening }}”</p>
      <table>
        <thead>
          <tr>
            <th>When the agent's reply matches</th>
            <th>The lead says</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="rule in session.rules" :key="rule.id">
            <td class="mono">/{{ rule.when }}/i</td>
            <td>
              “{{ rule.say }}” <span v-if="rule.end" class="badge">ends</span>
              <span class="muted mono">{{ rule.id }}</span>
            </td>
          </tr>
          <tr v-if="session.fallback">
            <td class="muted">Nothing matches (once)</td>
            <td>“{{ session.fallback }}”</td>
          </tr>
        </tbody>
      </table>
      <p class="hint">
        At most {{ session.maxTurns }} lead messages. Each rule fires once, first match wins.
      </p>
    </section>

    <section class="card">
      <h2>CRM at the start</h2>
      <pre>{{ JSON.stringify(d.crm, null, 2) }}</pre>
      <p class="hint">
        Slot days are relative to the run date (0 = today), in clinic time (America/Chicago).
      </p>
    </section>
  </template>
</template>
