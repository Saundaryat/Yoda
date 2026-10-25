<script setup lang="ts">
import type { TaskDefinition } from '@evals/shared';
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import { useResource } from '../composables/useResource.js';
import { groupName, taskName } from '../names.js';

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
  <p v-else-if="!data" class="muted" role="status">Loading scenario…</p>
  <template v-else-if="data && d">
    <div class="page-head">
      <div>
        <p class="subtitle"><RouterLink to="/tasks">← Scenarios</RouterLink></p>
        <p class="page-kicker">Scenario details</p>
        <h1>{{ taskName({ key: data.key, title: d.title }) }}</h1>
        <p class="subtitle">
          <span class="mono">{{ data.suite }}/{{ data.split }}/{{ data.key }}.yaml</span> · group
          {{ groupName(d.group) }} · version {{ data.versionHash.slice(0, 8) }}
        </p>
      </div>
    </div>
    <p v-if="d.description" class="card">{{ d.description }}</p>
    <details class="metadata">
      <summary>Original scenario title</summary>
      <p>{{ d.title }}</p>
    </details>

    <section class="card table-scroll">
      <h2>How it is scored</h2>
      <p class="hint">
        Score = weighted share of checks passed. The run passes when every critical check passes and
        the score is at least {{ d.passThreshold }}.
      </p>
      <p class="hint">
        These are the scenario-specific checks. Each scored run also checks claim grounding and CRM
        consistency; reply quality is reported separately.
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
            <td>
              <details>
                <summary>View rule</summary>
                <pre>{{ describeCheck(check) }}</pre>
              </details>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <section v-for="(session, i) in d.sessions" :key="i" class="card table-scroll">
      <h2>Customer script{{ d.sessions.length > 1 ? `, session ${i + 1}` : '' }}</h2>
      <p class="hint">
        Contact: {{ session.contact }}. Scripted mode uses the reply rules below; Claude mode uses
        them as intent guidance.
      </p>
      <p><strong>Opens with:</strong> “{{ session.opening }}”</p>
      <details v-if="session.persona">
        <summary>Customer persona for Claude mode</summary>
        <p>{{ session.persona }}</p>
      </details>
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
      <details>
        <summary>View starting CRM data</summary>
        <pre>{{ JSON.stringify(d.crm, null, 2) }}</pre>
      </details>
      <p class="hint">
        Slot days are relative to the run date (0 = today), in clinic time (America/Chicago).
      </p>
    </section>
  </template>
</template>
