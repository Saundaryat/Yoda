<script setup lang="ts">
import type { CrmState } from '@evals/shared';
import { computed } from 'vue';

/** What the agent changed in the CRM, in plain rows, plus the raw before/after state. */
const props = defineProps<{ before: CrmState; after: CrmState; focusPath: string | null }>();

const slotLabel = (state: CrmState, slotId: string) =>
  state.slots.find((s) => s.id === slotId)?.label ?? slotId;

const changes = computed(() => {
  const rows: { path: string; what: string; before: string; after: string }[] = [];
  for (const [id, contact] of Object.entries(props.after.contacts)) {
    const old = props.before.contacts[id];
    if (!old) continue;
    for (const field of ['stage', 'age', 'optedOut'] as const) {
      if (old[field] !== contact[field]) {
        rows.push({
          path: `contacts.${id}.${field}`,
          what: `${contact.name}: ${field}`,
          before: JSON.stringify(old[field]),
          after: JSON.stringify(contact[field]),
        });
      }
    }
    contact.notes.slice(old.notes.length).forEach((note) =>
      rows.push({
        path: `contacts.${id}.notes`,
        what: `${contact.name}: note added`,
        before: '',
        after: note,
      }),
    );
  }
  props.after.appointments.slice(props.before.appointments.length).forEach((a) =>
    rows.push({
      path: 'appointments',
      what: 'Appointment booked',
      before: '',
      after: `${a.serviceId} · ${slotLabel(props.after, a.slotId)} (${a.slotId}) for ${a.contactId}`,
    }),
  );
  props.after.escalations.slice(props.before.escalations.length).forEach((x) =>
    rows.push({
      path: 'escalations',
      what: `Escalated (${x.reason})`,
      before: '',
      after: x.summary,
    }),
  );
  return rows;
});
const focused = (path: string) => !!props.focusPath && props.focusPath.startsWith(path);
</script>

<template>
  <p v-if="!changes.length" class="muted">The agent changed nothing in the CRM.</p>
  <table v-else>
    <thead>
      <tr>
        <th>Change</th>
        <th>Before</th>
        <th>After</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="(row, i) in changes" :key="i" :class="{ focus: focused(row.path) }">
        <td>
          {{ row.what }}
          <div class="mono muted">{{ row.path }}</div>
        </td>
        <td class="mono">{{ row.before }}</td>
        <td>{{ row.after }}</td>
      </tr>
    </tbody>
  </table>
  <details class="raw">
    <summary>Raw CRM state (before / after)</summary>
    <div class="grid-2">
      <pre>{{ JSON.stringify({ ...before, audit: undefined }, null, 2) }}</pre>
      <pre>{{ JSON.stringify({ ...after, audit: undefined }, null, 2) }}</pre>
    </div>
  </details>
</template>

<style scoped>
tr.focus td {
  background: var(--warn-soft);
}
.raw {
  margin-top: 12px;
}
.raw summary {
  cursor: pointer;
  color: var(--muted);
  margin-bottom: 8px;
}
</style>
