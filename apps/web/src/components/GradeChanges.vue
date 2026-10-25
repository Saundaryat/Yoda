<script setup lang="ts">
import type { GradeChangeReport } from '@evals/shared';
import { computed, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { useResource } from '../composables/useResource.js';
import { taskName } from '../names.js';
const props = defineProps<{ experimentId: string }>();
const { data, error, loading } = useResource<GradeChangeReport>(
  computed(() => `/experiments/${props.experimentId}/grade-changes`),
);
const filter = ref('all');
const visible = computed(() =>
  (data.value?.changes ?? []).filter(
    (r) =>
      filter.value === 'all' ||
      (filter.value === 'regressions'
        ? r.previousPassed === true && r.passed === false
        : r.previousPassed === false && r.passed === true),
  ),
);
const grade = (passed: boolean | null) =>
  passed === null ? 'Needs grading' : passed ? 'Pass' : 'Fail';
</script>

<template>
  <section class="card grade-changes" aria-label="Grade changes from previous evaluation">
    <h2>Which grades changed?</h2>
    <p v-if="error" class="error">Could not load grade changes: {{ error }}</p>
    <p v-else-if="!data" role="status">
      {{
        loading
          ? 'Loading previous and current grades…'
          : 'Previous evaluation details are unavailable.'
      }}
    </p>
    <template v-else>
      <p class="hint" v-if="data.mode === 'judge-and-score'">
        Fresh model judgments under {{ data.evaluatorVersion }}. Identical saved conversations can
        receive different semantic judgments; these changes do not show new agent behavior.
      </p>
      <p>
        {{ data.comparedRuns }} runs compared · <strong>{{ data.passToFail }} pass → fail</strong> ·
        {{ data.failToPass }} fail → pass · {{ data.scoreOnlyChanges }} score-only changes ·
        {{ data.unchanged }} unchanged.
      </p>
      <p v-if="data.unmatchedRuns" class="error">
        {{ data.unmatchedRuns }} runs have no valid matching source and are excluded from this
        grade-change review.
      </p>
      <RouterLink :to="`/experiments/${data.sourceExperimentId}`">Previous evaluation →</RouterLink>
      <p v-if="!data.changes.length" class="hint">
        No pass/fail or numeric scores changed. The new scoring guards did not change these saved
        grades.
      </p>
      <template v-else>
        <label class="grade-filter"
          >Show
          <select v-model="filter" aria-label="Filter grade changes">
            <option value="all">All grade changes</option>
            <option value="regressions">Pass → fail</option>
            <option value="improvements">Fail → pass</option>
          </select>
        </label>
        <p v-if="!visible.length" class="hint">No changes match this filter.</p>
        <article
          v-for="run in visible"
          :key="run.runId"
          class="changed-run"
          :data-testid="`grade-change-${run.runId}`"
        >
          <h3>
            {{ run.side }} · {{ taskName({ key: run.taskKey, title: run.taskTitle }) }} · repetition
            {{ run.repetition }}
          </h3>
          <p class="grade-transition">
            <RouterLink :to="`/runs/${run.sourceRunId}`"
              >{{ grade(run.previousPassed) }} · {{ run.previousScore ?? '—' }}</RouterLink
            >
            →
            <RouterLink :to="`/runs/${run.runId}`"
              >{{ grade(run.passed) }} · {{ run.score ?? '—' }}</RouterLink
            >
          </p>
          <details>
            <summary>Why the grade changed</summary>
            <p v-if="!run.reasons.length" class="hint">
              The aggregate score changed. Review the full scoring checks in the linked runs.
            </p>
            <div v-for="reason in run.reasons" :key="reason.checkId" class="changed-check">
              <strong>{{ reason.label }}{{ reason.critical ? ' · critical' : '' }}</strong>
              <p>
                <b>Previously:</b>
                {{
                  reason.previous?.skipped
                    ? 'Not judged'
                    : reason.previous
                      ? grade(reason.previous.passed)
                      : 'No check'
                }}. {{ reason.previous?.detail }}
              </p>
              <p>
                <b>Now:</b>
                {{
                  reason.current?.skipped
                    ? 'Needs grading'
                    : reason.current
                      ? grade(reason.current.passed)
                      : 'No check'
                }}. {{ reason.current?.detail }}
              </p>
              <p v-if="reason.current?.evidence.length" class="hint">
                Current evidence:
                {{
                  reason.current.evidence
                    .map((e) => (e.eventSeq ? `message/tool #${e.eventSeq}` : e.statePath))
                    .join(', ')
                }}. Open the current run to inspect it.
              </p>
            </div>
            <RouterLink :to="`/runs/${run.runId}`">Open current run and evidence →</RouterLink>
          </details>
        </article>
      </template>
    </template>
  </section>
</template>

<style scoped>
.grade-changes {
  margin-top: 16px;
  margin-bottom: 16px;
}
.grade-filter {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin: 16px 0;
}
.grade-filter select {
  width: auto;
  max-width: 100%;
}
.changed-run {
  padding: 16px 0;
  border-top: 1px solid var(--border);
  overflow-wrap: anywhere;
}
.changed-run h3 {
  margin-bottom: 8px;
  font-size: 14px;
}
.grade-transition {
  font-weight: 600;
}
.changed-check {
  margin: 12px 0;
  padding: 12px;
  background: var(--surface-2);
  border-radius: 6px;
}
.changed-check p {
  margin: 8px 0;
}
</style>
