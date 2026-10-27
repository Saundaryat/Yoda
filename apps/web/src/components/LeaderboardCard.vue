<script setup lang="ts">
import type { Configuration, Leaderboard, LeaderboardEntry } from '@evals/shared';
import { computed, ref, watch } from 'vue';
import { money, percent, points, seconds } from '../format.js';
import { configurationName } from '../names.js';

const props = defineProps<{
  leaderboard: Leaderboard;
  configurations: Configuration[];
  pair: { a: string; b: string };
}>();
const emit = defineEmits<{ selectPair: [a: string, b: string] }>();

const nameOf = (configId: string) =>
  configurationName(props.configurations.find((c) => c.id === configId));
const byLetter = computed(() =>
  [...props.leaderboard.entries].sort((x, y) => x.letter.localeCompare(y.letter)),
);
const confidence = computed(() => percent(props.leaderboard.comparisonConfidence, 1));

const VS_BASELINE: Record<string, { text: string; tone: string }> = {
  better: { text: 'Better than A', tone: 'good' },
  worse: { text: 'Worse than A', tone: 'bad' },
  no_meaningful_difference: { text: 'Same as A', tone: 'neutral' },
  inconclusive: { text: 'Inconclusive', tone: 'warn' },
  incomplete: { text: 'Incomplete', tone: 'warn' },
};
const versus = (entry: LeaderboardEntry) =>
  entry.vsBaseline ? VS_BASELINE[entry.vsBaseline.verdict] : { text: 'Baseline', tone: '' };

const left = ref(props.pair.a);
const right = ref(props.pair.b);
watch(
  () => props.pair,
  (pair) => {
    left.value = pair.a;
    right.value = pair.b;
  },
);
const canCompare = computed(
  () => left.value !== right.value && (left.value !== props.pair.a || right.value !== props.pair.b),
);
</script>

<template>
  <section class="card table-scroll leaderboard" aria-label="Leaderboard">
    <h2>Leaderboard</h2>
    <p class="muted">
      Every version ran the same scenarios and repetitions, so they are ranked side by side. Each
      version's comparison with A uses a {{ confidence }} interval, widened because several versions
      are compared with the same baseline.
    </p>
    <table>
      <thead>
        <tr>
          <th>Rank</th>
          <th>Version</th>
          <th class="num">Pass rate (95% CI)</th>
          <th class="num" title="Scenarios where every repetition passed">All runs pass</th>
          <th class="num">Difference vs A</th>
          <th>Verdict vs A</th>
          <th class="num">Cost / run</th>
          <th class="num">Time / run</th>
          <th class="num">Tokens / run</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="entry in leaderboard.entries"
          :key="entry.configId"
          :class="{ selected: entry.configId === pair.a || entry.configId === pair.b }"
        >
          <td>#{{ entry.rank }}</td>
          <td>
            <strong>{{ entry.letter }}</strong> · {{ nameOf(entry.configId) }}
            <small v-if="entry.scoredRuns < entry.plannedRuns" class="muted">
              ({{ entry.scoredRuns }}/{{ entry.plannedRuns }} runs scored)</small
            >
          </td>
          <td class="num">
            {{ percent(entry.passRate) }}
            <small class="muted">{{ percent(entry.ci[0]) }}–{{ percent(entry.ci[1]) }}</small>
          </td>
          <td class="num">{{ percent(entry.allRunsPass) }}</td>
          <td class="num">
            <template v-if="entry.vsBaseline">
              {{ points(entry.vsBaseline.difference) }}
              <small class="muted"
                >{{ points(entry.vsBaseline.ci[0]) }} to {{ points(entry.vsBaseline.ci[1]) }}</small
              >
            </template>
            <template v-else>—</template>
          </td>
          <td>
            <span :class="['tone', versus(entry)!.tone]">{{ versus(entry)!.text }}</span>
          </td>
          <td class="num">{{ money(entry.costUsd) }}</td>
          <td class="num">{{ seconds(entry.durationMs) }}</td>
          <td class="num">
            {{ entry.totalTokens === null ? '—' : Math.round(entry.totalTokens).toLocaleString() }}
          </td>
        </tr>
      </tbody>
    </table>
    <form class="pair-picker" @submit.prevent="emit('selectPair', left, right)">
      <span>Detailed comparison below:</span>
      <select v-model="left" aria-label="First version">
        <option v-for="entry in byLetter" :key="entry.configId" :value="entry.configId">
          {{ entry.letter }} · {{ nameOf(entry.configId) }}
        </option>
      </select>
      <span>vs</span>
      <select v-model="right" aria-label="Second version">
        <option
          v-for="entry in byLetter"
          :key="entry.configId"
          :value="entry.configId"
          :disabled="entry.configId === left"
        >
          {{ entry.letter }} · {{ nameOf(entry.configId) }}
        </option>
      </select>
      <button class="button" type="submit" :disabled="!canCompare">Compare</button>
    </form>
  </section>
</template>

<style scoped>
.leaderboard td small {
  display: block;
}
tr.selected td {
  background: var(--surface-muted, #f6f7f9);
}
.tone.good {
  color: var(--good, #1a7f37);
}
.tone.bad {
  color: var(--bad, #cf222e);
}
.tone.warn {
  color: var(--warn, #9a6700);
}
.pair-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-top: 12px;
}
</style>
