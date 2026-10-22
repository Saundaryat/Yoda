<script setup lang="ts">
import { computed } from 'vue';

/** A difference and its 95% interval on a −100…+100 point axis, with the "too small to matter" band. */
const props = defineProps<{ estimate: number; ci: [number, number]; margin: number }>();

const WIDTH = 560;
const PAD = 24;
const x = (value: number) => PAD + ((value + 1) / 2) * (WIDTH - 2 * PAD);
const ticks = [-1, -0.5, 0, 0.5, 1];
const bar = computed(() => ({ from: x(props.ci[0]), to: x(props.ci[1]), at: x(props.estimate) }));
</script>

<template>
  <svg
    :viewBox="`0 0 ${WIDTH} 64`"
    class="interval"
    role="img"
    :aria-label="`Difference ${Math.round(estimate * 100)} points, 95% interval ${Math.round(ci[0] * 100)} to ${Math.round(ci[1] * 100)}`"
  >
    <rect :x="x(-margin)" y="10" :width="x(margin) - x(-margin)" height="28" class="band" />
    <line :x1="x(0)" :x2="x(0)" y1="6" y2="42" class="zero" />
    <line :x1="bar.from" :x2="bar.to" y1="24" y2="24" class="ci" />
    <line :x1="bar.from" :x2="bar.from" y1="17" y2="31" class="ci" />
    <line :x1="bar.to" :x2="bar.to" y1="17" y2="31" class="ci" />
    <circle :cx="bar.at" cy="24" r="6" class="point" />
    <g v-for="t in ticks" :key="t">
      <text :x="x(t)" y="58" text-anchor="middle" class="tick">
        {{ t > 0 ? '+' : '' }}{{ t * 100 }}
      </text>
    </g>
  </svg>
</template>

<style scoped>
.interval {
  width: 100%;
  max-width: 560px;
  display: block;
}
.band {
  fill: var(--surface-2);
}
.zero {
  stroke: var(--muted);
  stroke-dasharray: 3 3;
}
.ci {
  stroke: var(--b);
  stroke-width: 3;
}
.point {
  fill: var(--b);
}
.tick {
  font-size: 11px;
  fill: var(--muted);
}
</style>
