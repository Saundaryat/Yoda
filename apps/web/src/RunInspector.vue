<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { api, pretty, shortId } from './api.ts';
const props = defineProps<{ runId: string }>();
const emit = defineEmits<{ close: [] }>();
const run = ref<any>(null), events = ref<any[]>([]), grades = ref<any[]>([]), error = ref(''), tab = ref('Conversation'), highlight = ref('');
watch(() => props.runId, async id => {
  error.value = ''; run.value = null;
  try { [run.value, events.value, grades.value] = await Promise.all([api(`/runs/${id}`), api(`/runs/${id}/events`), api(`/runs/${id}/grades`)]); }
  catch (e) { error.value = (e as Error).message; }
}, { immediate: true });
const conversation = computed(() => run.value?.final_state?.events.filter((e: any) => e.type === 'lead' || e.name === 'send_message') ?? []);
const crm = computed(() => events.value.filter(e => e.source === 'crm'));
async function evidence(id: string) {
  tab.value = 'Tools & evidence'; highlight.value = id;
  await nextTick(); document.getElementById(`audit-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
</script>
<template>
  <div class="drawer-scrim" @click.self="emit('close')">
    <section class="drawer" role="dialog" aria-modal="true" aria-label="Run inspector" @keydown.esc="emit('close')" tabindex="-1">
      <header class="drawer-head"><div><p class="eyebrow">Run inspector · {{ shortId(runId) }}</p><h2>{{ run?.task_snapshot.title ?? 'Loading run…' }}</h2></div><button class="icon-button" aria-label="Close inspector" @click="emit('close')">✕</button></header>
      <p v-if="error" class="alert" role="alert">{{ error }}</p>
      <template v-if="run">
        <div class="run-summary"><span :class="['badge', run.grade?.status ?? run.status]">{{ run.grade?.status ?? run.status }}</span><strong>{{ run.grade?.score ?? '—' }}<small>/100</small></strong><span>{{ run.configuration_snapshot.name }}</span><span class="muted">{{ run.runtime?.turns?.length ?? 0 }} turns · {{ run.grade?.version ?? 'Not graded' }}</span></div>
        <p v-if="run.error" class="alert">{{ run.error.message }}</p>
        <details v-if="run.runtime?.classificationCorrection" class="alert"><summary>Infrastructure classification corrected; original preserved</summary><pre>{{ pretty(run.runtime.classificationCorrection) }}</pre></details>
        <nav class="tabs" aria-label="Run detail sections"><button v-for="name in ['Conversation','Tools & evidence','Grades','State']" :key="name" :class="{ active: tab === name }" @click="tab = name">{{ name }}</button></nav>
        <div class="drawer-content">
          <div v-if="tab === 'Conversation'" class="conversation">
            <p v-if="!conversation.length" class="empty">No conversation checkpoint yet.</p>
            <article v-for="event in conversation" :key="event.id" :class="['bubble', event.type === 'lead' ? 'lead' : 'agent']"><p class="eyebrow">{{ event.type === 'lead' ? 'Lead' : 'Agent · ' + event.arguments.intent }} <span>{{ event.id }}</span></p><p>{{ event.type === 'lead' ? event.result.text : event.arguments.text }}</p><small v-if="event.result.error" class="failure">Delivery blocked: {{ event.result.error }}</small></article>
            <details><summary>Runtime responses and metadata</summary><pre>{{ pretty(run.runtime?.turns) }}</pre></details>
          </div>
          <div v-if="tab === 'Tools & evidence'">
            <p class="caption">CRM records contain complete arguments and results. Hermes events preserve runtime progress separately.</p>
            <article v-for="event in crm" :id="`audit-${event.event_id}`" :key="event.event_id" :class="['audit', { highlighted: highlight === event.event_id }]"><div class="row"><code>{{ event.event_id }}</code><strong>{{ event.payload.name }}</strong><span :class="['badge', event.payload.result.error ? 'failed' : 'passed']">{{ event.payload.result.error ? 'rejected' : event.payload.type }}</span></div><details :open="highlight === event.event_id"><summary>Arguments & result</summary><pre>{{ pretty({ arguments: event.payload.arguments, result: event.payload.result }) }}</pre></details></article>
            <details><summary>Hermes runtime events ({{ events.filter(e => e.source === 'hermes').length }})</summary><pre>{{ pretty(events.filter(e => e.source === 'hermes')) }}</pre></details>
          </div>
          <div v-if="tab === 'Grades'">
            <p v-if="!grades.length" class="empty">Assertions become available when grading completes.</p>
            <article v-for="grade in grades" :key="grade.rule" class="assertion"><div class="row"><span :class="['badge', grade.status]">{{ grade.status.replaceAll('_',' ') }}</span><strong>{{ grade.rule.replaceAll('_',' ') }}</strong><span v-if="grade.hardFailure" class="failure">Hard failure</span></div><p>{{ grade.explanation }}</p><small class="muted">{{ grade.dimension }} · {{ grade.mandatory ? 'Required' : 'Diagnostic' }}</small><div class="evidence-links"><button v-for="id in grade.evidence.eventIds" :key="id" class="link" @click="evidence(id)">{{ id }} ↗</button></div><details><summary>Expected / actual</summary><pre>{{ pretty({ expected: grade.expected, actual: grade.actual, statePaths: grade.evidence.statePaths }) }}</pre></details></article>
          </div>
          <div v-if="tab === 'State'" class="state-grid"><section><h3>Initial state</h3><pre>{{ pretty(run.initial_state) }}</pre></section><section><h3>Final state</h3><pre>{{ pretty(run.final_state) }}</pre></section></div>
        </div>
      </template>
    </section>
  </div>
</template>
