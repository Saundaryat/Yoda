<script setup lang="ts">
import type { CheckResult } from '@evals/shared';

defineProps<{ checks: CheckResult[] }>();
const emit = defineEmits<{ focus: [seqs: number[]]; state: [path: string] }>();
</script>

<template>
  <ul class="checks">
    <li
      v-for="check in checks"
      :key="check.checkId"
      :class="check.skipped ? 'skipped' : check.passed ? 'pass' : 'fail'"
    >
      <div class="title">
        <span class="mark">{{ check.skipped ? '–' : check.passed ? '✓' : '✗' }}</span>
        <span>{{ check.label }}</span>
      </div>
      <div class="meta">
        <span class="badge mono">{{ check.type }}</span>
        <span v-if="check.type === 'llm_judge' || check.type === 'reply_judge'" class="badge info"
          >LLM-judged</span
        >
        <span v-if="check.type === 'reply_judge' || check.type === 'invariant'" class="badge"
          >every run</span
        >
        <span v-if="check.skipped" class="badge">not judged</span>
        <span v-if="check.critical" class="badge warn">critical</span>
        <span class="badge">weight {{ check.weight }}</span>
      </div>
      <div class="detail">{{ check.detail }}</div>
      <div v-if="check.evidence.length" class="evidence">
        <button
          v-if="check.evidence.some((e) => e.eventSeq)"
          @click="
            emit(
              'focus',
              check.evidence.flatMap((e) => (e.eventSeq ? [e.eventSeq] : [])),
            )
          "
        >
          Show in conversation ({{
            check.evidence
              .filter((e) => e.eventSeq)
              .map((e) => `#${e.eventSeq}`)
              .join(', ')
          }})
        </button>
        <button
          v-for="e in check.evidence.filter((x) => x.statePath)"
          :key="e.statePath"
          @click="emit('state', e.statePath!)"
        >
          Show CRM field <span class="mono">{{ e.statePath }}</span>
        </button>
      </div>
    </li>
  </ul>
</template>

<style scoped>
.checks {
  list-style: none;
  margin: 0;
  padding: 0;
}
li {
  border-left: 3px solid var(--border);
  padding: 8px 10px;
  margin-bottom: 8px;
  background: var(--surface-2);
  border-radius: 0 6px 6px 0;
}
li.pass {
  border-left-color: var(--good);
}
li.skipped {
  opacity: 0.6;
}
li.fail {
  border-left-color: var(--bad);
}
.title {
  display: flex;
  gap: 8px;
  font-weight: 600;
}
.pass .mark {
  color: var(--good);
}
.fail .mark {
  color: var(--bad);
}
.meta {
  display: flex;
  gap: 4px;
  margin: 4px 0;
  flex-wrap: wrap;
}
.detail {
  color: var(--muted);
  font-size: 13px;
}
.evidence {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 6px;
}
.evidence button {
  font-size: 12px;
  padding: 3px 8px;
}
</style>
