<script setup lang="ts">
import type { RunEvent } from '@evals/shared';

/** A run's conversation: lead messages, agent replies and every tool call in between. */
const props = defineProps<{ events: RunEvent[]; highlighted: number[] }>();

const startsSession = (index: number) =>
  index === 0 || props.events[index - 1]!.session !== props.events[index]!.session;
const pretty = (value: unknown) =>
  typeof value === 'string' ? value : JSON.stringify(value, null, 2);
</script>

<template>
  <ol class="timeline">
    <template v-for="(event, index) in events" :key="event.seq">
      <li v-if="startsSession(index) && events.some((e) => e.session > 1)" class="session">
        Session {{ event.session
        }}{{ event.session > 1 ? ' — a new conversation with the same lead' : '' }}
      </li>
      <li
        :id="`event-${event.seq}`"
        class="event"
        :class="[event.kind, { highlight: highlighted.includes(event.seq) }]"
      >
        <span class="seq">#{{ event.seq }}</span>
        <template v-if="event.kind === 'lead'">
          <div class="bubble">
            <div class="who">
              Lead
              <span v-if="event.by === 'llm'" class="badge info">LLM</span>
              <span v-if="event.ruleId" class="badge">
                {{ event.by === 'llm' ? 'means' : 'rule' }}: {{ event.ruleId }}
              </span>
              <span v-if="event.fallback" class="badge warn">fallback</span>
            </div>
            {{ event.text }}
          </div>
        </template>
        <template v-else-if="event.kind === 'agent'">
          <div class="bubble">
            <div class="who">Agent reply</div>
            <span v-if="event.text">{{ event.text }}</span>
            <em v-else class="muted">(empty reply)</em>
          </div>
        </template>
        <template v-else-if="event.kind === 'tool'">
          <details class="tool" :class="{ rejected: !event.ok }">
            <summary>
              <span class="mono">{{ event.tool }}</span>
              <span class="badge" :class="event.source === 'crm' ? 'info' : ''">{{
                event.source === 'crm' ? 'CRM' : 'Hermes'
              }}</span>
              <span v-if="!event.ok" class="badge bad">rejected</span>
              <span class="args mono">{{ JSON.stringify(event.args) }}</span>
            </summary>
            <div class="io">
              <div>
                <h3>Arguments</h3>
                <pre>{{ pretty(event.args) }}</pre>
              </div>
              <div>
                <h3>Result</h3>
                <pre>{{ pretty(event.result) }}</pre>
              </div>
            </div>
          </details>
        </template>
        <div v-else class="note">{{ event.text }}</div>
      </li>
    </template>
  </ol>
</template>

<style scoped>
.timeline {
  list-style: none;
  margin: 0;
  padding: 0;
}
.event {
  position: relative;
  padding: 4px 0 4px 40px;
  border-radius: 6px;
  transition: background 0.3s;
}
.event.highlight {
  background: var(--warn-soft);
}
.seq {
  position: absolute;
  left: 4px;
  top: 10px;
  font-size: 11px;
  color: var(--muted);
  font-family: var(--mono);
}
.session {
  margin: 16px 0 8px;
  font-weight: 600;
  color: var(--muted);
  border-top: 1px dashed var(--border);
  padding-top: 8px;
}
.bubble {
  max-width: 85%;
  padding: 8px 12px;
  border-radius: 10px;
  white-space: pre-wrap;
}
.lead .bubble {
  background: var(--surface-2);
}
.agent .bubble {
  background: var(--accent-soft);
  margin-left: auto;
}
.who {
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
  margin-bottom: 2px;
  display: flex;
  gap: 6px;
  align-items: center;
}
.tool {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 10px;
  background: var(--surface);
}
.tool.rejected {
  border-color: var(--bad);
}
.tool summary {
  cursor: pointer;
  display: flex;
  gap: 8px;
  align-items: center;
  overflow: hidden;
}
.args {
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.io {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 8px;
}
.io h3 {
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 4px;
}
.note {
  font-size: 12px;
  font-style: italic;
  color: var(--muted);
}
@media (max-width: 640px) {
  .io {
    grid-template-columns: 1fr;
  }
}
</style>
