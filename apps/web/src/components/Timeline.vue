<script setup lang="ts">
import type { LeadLabel, RunEvent, TurnJudgment } from '@evals/shared';
import { computed, ref } from 'vue';
import { ISSUE_TEXT, label, percent } from '../format.js';

/** A run's conversation: lead messages, agent replies and every tool call in between. */
const props = defineProps<{
  events: RunEvent[];
  highlighted: number[];
  judgments?: TurnJudgment[];
  leadLabels?: LeadLabel[];
  idPrefix?: string;
}>();

const startsSession = (index: number) =>
  index === 0 || props.events[index - 1]!.session !== props.events[index]!.session;
const pretty = (value: unknown) =>
  typeof value === 'string' ? value : JSON.stringify(value, null, 2);
const judgmentFor = (seq: number) => props.judgments?.find((j) => j.eventSeq === seq);
const leadLabelFor = (seq: number) => props.leadLabels?.find((l) => l.eventSeq === seq);
const showDetails = ref(false);
const messages = computed(
  () => props.events.filter((e) => e.kind === 'lead' || e.kind === 'agent').length,
);
const toolCalls = computed(() => props.events.filter((e) => e.kind === 'tool').length);
</script>

<template>
  <div class="conversation-toolbar">
    <span>{{ messages }} messages · {{ toolCalls }} tool calls</span
    ><label
      ><input v-model="showDetails" type="checkbox" /> Show tool calls and internal notes</label
    >
  </div>
  <ol class="timeline">
    <template v-for="(event, index) in events" :key="event.seq">
      <li v-if="startsSession(index) && events.some((e) => e.session > 1)" class="session">
        Session {{ event.session
        }}{{ event.session > 1 ? ' — a new conversation; check tools for the contact' : '' }}
      </li>
      <li
        v-if="
          event.kind === 'lead' ||
          event.kind === 'agent' ||
          showDetails ||
          highlighted.includes(event.seq)
        "
        :id="`${idPrefix ?? 'event'}-${event.seq}`"
        class="event"
        :class="[event.kind, { highlight: highlighted.includes(event.seq) }]"
      >
        <span class="seq">#{{ event.seq }}</span>
        <template v-if="event.kind === 'lead'">
          <div class="bubble">
            <div class="who">
              Customer
              <span v-if="showDetails && event.by === 'llm'" class="badge info">Simulated</span>
              <span v-if="showDetails && event.ruleId" class="badge">
                {{ event.by === 'llm' ? 'means' : 'rule' }}: {{ event.ruleId }}
              </span>
              <span v-if="event.fallback" class="badge warn">fallback</span>
              <span
                v-if="showDetails && leadLabelFor(event.seq)"
                class="badge"
                title="Judge's label for this message"
              >
                {{ label(leadLabelFor(event.seq)!.intent) }} · {{ leadLabelFor(event.seq)!.mood }}
              </span>
            </div>
            <span class="message-text">{{ event.text }}</span>
          </div>
        </template>
        <template v-else-if="event.kind === 'agent'">
          <div class="bubble">
            <div class="who">
              Agent reply
              <template v-if="judgmentFor(event.seq)">
                <span v-if="showDetails" class="badge" title="What kind of reply this was">{{
                  label(judgmentFor(event.seq)!.act)
                }}</span>
                <span
                  v-if="showDetails && !judgmentFor(event.seq)!.issues.length"
                  class="badge good"
                  >No findings</span
                >
                <span v-if="judgmentFor(event.seq)!.issues.length" class="badge warn"
                  >{{ judgmentFor(event.seq)!.issues.length }}
                  {{ judgmentFor(event.seq)!.issues.length === 1 ? 'finding' : 'findings' }}</span
                >
              </template>
            </div>
            <span v-if="event.text" class="message-text">{{ event.text }}</span>
            <em v-else class="muted">(empty reply)</em>
            <details v-if="judgmentFor(event.seq)?.grounded.review" class="judge-details">
              <summary>Grounding evidence review</summary>
              <p>
                Original model finding:
                {{ judgmentFor(event.seq)!.grounded.review!.modelVerdict.reason }}
              </p>
              <blockquote class="evidence-quote">
                {{ judgmentFor(event.seq)!.grounded.review!.modelVerdict.quote }}
              </blockquote>
              <p>
                Reviewed: {{ judgmentFor(event.seq)!.grounded.pass ? 'Pass' : 'Fail' }} ·
                {{ judgmentFor(event.seq)!.grounded.reason }}
              </p>
              <p v-if="judgmentFor(event.seq)!.grounded.review!.evidenceSeqs.length">
                Evidence:
                {{
                  judgmentFor(event.seq)!
                    .grounded.review!.evidenceSeqs.map((seq) => `#${seq}`)
                    .join(', ')
                }}.
              </p>
            </details>
            <details v-if="judgmentFor(event.seq)?.issues.length" class="judge-details">
              <summary>Review scoring evidence</summary>
              <ul class="judge-notes">
                <li
                  v-for="issue in judgmentFor(event.seq)!.issues"
                  :key="`${issue.label}/${issue.quote}`"
                >
                  <strong>{{ ISSUE_TEXT[issue.label] ?? label(issue.label) }}:</strong>
                  {{ issue.reason }}
                  <blockquote class="evidence-quote">{{ issue.quote }}</blockquote>
                  <span v-if="issue.evidenceRule" class="badge bad"
                    >CRM evidence rule: {{ issue.evidenceRule.severity }} ·
                    {{ issue.evidenceRule.id }}</span
                  >
                  <details v-if="issue.evidenceRule" class="rule-provenance">
                    <summary>Original model assessment</summary>
                    <p>
                      Before the CRM check:
                      {{ issue.evidenceRule.modelVerdict.pass ? 'Pass' : 'Fail' }}.
                      {{ issue.evidenceRule.modelVerdict.reason }}
                    </p>
                    <p v-if="issue.evidenceRule.evidenceSeqs.length">
                      Earlier search evidence:
                      {{ issue.evidenceRule.evidenceSeqs.map((seq) => `#${seq}`).join(', ') }}.
                    </p>
                  </details>
                  <span
                    v-if="issue.severity"
                    class="badge"
                    :class="issue.severity.label === 'minor' ? 'warn' : 'bad'"
                  >
                    Jev: {{ issue.severity.label }} ·
                    {{ percent(issue.severity.confidence) }} confidence · p(minor)
                    {{ percent(issue.severity.probabilities.minor) }} · p(serious)
                    {{ percent(issue.severity.probabilities.serious) }}
                  </span>
                </li>
              </ul>
            </details>
          </div>
        </template>
        <template v-else-if="event.kind === 'tool'">
          <details
            class="tool"
            :class="{ rejected: !event.ok }"
            :open="highlighted.includes(event.seq)"
          >
            <summary>
              <span class="mono">{{ event.tool }}</span>
              <span class="badge" :class="event.source === 'crm' ? 'info' : ''">{{
                event.source === 'crm' ? 'CRM' : 'Hermes'
              }}</span>
              <span v-if="!event.ok" class="badge bad">rejected</span>
              <span v-else class="badge good">succeeded</span>
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
  min-width: 0;
  overflow-wrap: anywhere;
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
  flex-wrap: wrap;
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
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-top: 8px;
}
.io h3 {
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 4px;
}
.judge-notes {
  margin: 6px 0 0;
  padding: 6px 0 0 16px;
  border-top: 1px solid var(--border);
  font-size: 12px;
  color: var(--bad);
}
.judge-details {
  margin-top: 10px;
  white-space: normal;
}
.judge-details summary {
  color: var(--muted);
  font-size: 12px;
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
