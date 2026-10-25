<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { api, percent, points, pretty, shortId, terminal } from './api.ts';
import RunInspector from './RunInspector.vue';

const section = ref(location.hash.slice(1) || 'experiments');
const readOnly = ref(false);
const sections = [{ id: 'experiments', label: 'Experiments', icon: '◫' }, { id: 'suites', label: 'Task suites', icon: '▤' }, { id: 'configurations', label: 'Configurations', icon: '⌘' }, { id: 'methodology', label: 'Methodology', icon: '◎' }];
const suites = ref<any[]>([]), configs = ref<any[]>([]), experiments = ref<any[]>([]), selected = ref<any>(null), results = ref<any>(null), diff = ref<any>(null);
const selectedSuite = ref<any>(null), inspectedRun = ref(''), error = ref(''), notice = ref(''), loading = ref(true), busy = ref(false), live = ref(false);
const dialog = ref<HTMLDialogElement>(), suiteId = ref(''), baselineId = ref(''), candidateId = ref(''), repetitions = ref(1);
const runFilter = ref('all');
const configForm = ref({ name: '', provider: 'copilot', model: 'gpt-4.1', instructions: '', memoryEnabled: false });
let stream: EventSource | undefined, poll: ReturnType<typeof setInterval> | undefined;
const refreshing = new Set<string>();
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
const configName = (id: string) => selected.value?.snapshot.configurations.find((c: any) => c.id === id)?.definition.name ?? configs.value.find(c => c.id === id)?.definition.name ?? shortId(id);
const completed = computed(() => selected.value?.runs.filter((r: any) => !['queued','running','grading'].includes(r.status)).length ?? 0);
const conclusion = computed(() => results.value?.conclusion?.replaceAll('_', ' ') ?? 'Awaiting results');
const interval = computed(() => results.value?.confidenceInterval as [number, number] | null);
const visibleRuns = computed(() => selected.value?.runs.filter((r: any) => runFilter.value === 'all' || runFilter.value === 'failures' && (r.grade?.status === 'failed' || ['infra_error','agent_failed','ungradable'].includes(r.status)) || runFilter.value === 'active' && ['queued','running','grading'].includes(r.status)) ?? []);
const changedTasks = computed(() => results.value?.taskComparisons.filter((t: any) => t.validPairs && (t.passDifference !== 0 || t.scoreDifference !== 0)) ?? []);
async function load() {
  try {
    const health = await api('/health'); readOnly.value = Boolean(health.readOnly);
    [suites.value, configs.value, experiments.value] = await Promise.all([api('/task-suites'), api('/configurations'), api('/experiments')]);
    selectedSuite.value ??= suites.value[0]; suiteId.value ||= suites.value[0]?.id ?? ''; baselineId.value ||= configs.value[0]?.id ?? '';
    if (!configForm.value.instructions) configForm.value.instructions = configs.value.at(-1)?.definition.instructions ?? '';
  } catch (e) { error.value = (e as Error).message; }
  finally { loading.value = false; }
}
async function refreshSelected() {
  if (!selected.value) return;
  const id = selected.value.id;
  if (refreshing.has(id)) return;
  refreshing.add(id);
  try {
    const [detail, summary, differences] = await Promise.all([api(`/experiments/${id}`), api(`/experiments/${id}/results`), api(`/experiments/${id}/diff`)]);
    if (selected.value?.id === id) { selected.value = detail; results.value = summary; diff.value = differences; }
  } finally { refreshing.delete(id); }
}
async function selectExperiment(id: string) {
  stream?.close(); if (poll) clearInterval(poll); live.value = false; error.value = '';
  runFilter.value = 'all'; results.value = null; diff.value = null;
  try {
    selected.value = await api(`/experiments/${id}`); await refreshSelected();
    if (!terminal(selected.value.status)) {
      stream = new EventSource(`/api/experiments/${id}/stream`);
      stream.onopen = () => { live.value = true; };
      stream.onmessage = event => {
        const message = JSON.parse(event.data);
        if (!refreshTimer) refreshTimer = setTimeout(() => { refreshTimer = undefined; void refreshSelected().catch(() => {}); }, 150);
        if (message.type === 'stream.terminal') { stream?.close(); live.value = false; void load(); }
      };
      stream.onerror = () => { live.value = false; };
      poll = setInterval(() => { void refreshSelected().catch(() => {}); }, 3000);
    }
  } catch (e) { error.value = (e as Error).message; }
}
async function createExperiment() {
  busy.value = true; error.value = '';
  try {
    const ids = candidateId.value ? [baselineId.value, candidateId.value] : [baselineId.value];
    const created = await api('/experiments', { suiteId: suiteId.value, configurationIds: ids, repetitions: Number(repetitions.value) });
    dialog.value?.close(); section.value = 'experiments'; await load(); await selectExperiment(created.id);
  } catch (e) { error.value = (e as Error).message; }
  finally { busy.value = false; }
}
async function action(kind: 'start' | 'cancel') {
  if (!selected.value) return;
  busy.value = true;
  try { await api(`/experiments/${selected.value.id}/${kind}`, {}); await selectExperiment(selected.value.id); await load(); }
  catch (e) { error.value = (e as Error).message; }
  finally { busy.value = false; }
}
async function saveConfiguration() {
  busy.value = true; error.value = '';
  try { await api('/configurations', configForm.value); notice.value = 'Immutable configuration saved.'; await load(); configForm.value.name = ''; }
  catch (e) { error.value = (e as Error).message; }
  finally { busy.value = false; }
}
async function importSuite(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return;
  try { await api('/task-suites', JSON.parse(await file.text())); await load(); notice.value = 'Suite revision imported.'; }
  catch (e) { error.value = (e as Error).message; }
}
function navigate(id: string) { section.value = id; location.hash = id; }
function hashChange() { section.value = location.hash.slice(1) || 'experiments'; }
onMounted(async () => { window.addEventListener('hashchange', hashChange); await load(); if (experiments.value.length) await selectExperiment(experiments.value[0].id); });
onUnmounted(() => { stream?.close(); if (poll) clearInterval(poll); if (refreshTimer) clearTimeout(refreshTimer); window.removeEventListener('hashchange', hashChange); });
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar"><a class="brand" href="#experiments" @click="navigate('experiments')"><span class="brand-mark">t<span>·</span></span>tracework</a><p class="workspace-label">WORKSPACE</p><div class="workspace"><span class="workspace-icon">H</span><div>Hermes evaluations<small>Local workspace</small></div><span class="status-dot"></span></div><nav aria-label="Main navigation"><button v-for="item in sections" :key="item.id" :aria-label="item.label" :class="{ active: section === item.id }" @click="navigate(item.id)"><span>{{ item.icon }}</span>{{ item.label }}<small v-if="item.id === 'experiments'">{{ experiments.length }}</small></button></nav><div class="sidebar-bottom"><span class="status-dot"></span> Local · synthetic CRM<small>Evidence before intuition.</small></div></aside>
    <main>
      <div class="topbar"><span>Workspace <span class="muted">/</span> {{ sections.find(s => s.id === section)?.label }}</span><span class="local-label"><span class="status-dot"></span> Local evaluation workspace</span></div>
      <div class="page">
        <div v-if="error" class="alert" role="alert">{{ error }}<button class="link" @click="error = ''; load()">Retry</button></div>
        <p v-if="notice" class="notice" role="status">{{ notice }} <button class="link" @click="notice = ''">Dismiss</button></p>
        <p v-if="readOnly" class="notice" role="status">Read-only review · saved real inference with v4.2 offline grades · no model calls. New workflow instructions have not had fresh model validation.</p>
        <p v-if="loading" class="empty">Connecting to the evaluation backend…</p>
        <template v-else-if="section === 'experiments'">
          <header class="page-header"><div><p class="eyebrow">Measure what changed</p><h1>Experiments</h1><p class="subtitle">Compare agent behavior. Follow every result back to evidence.</p></div><button class="primary" :disabled="readOnly" @click="dialog?.showModal()">＋ New experiment</button></header>
          <div class="experiment-layout">
            <section class="experiment-list panel"><div class="panel-title"><h3>Recent experiments</h3><span class="count">{{ experiments.length }}</span></div><p v-if="!experiments.length" class="empty">Your first comparison starts here. Create an experiment to choose a suite and configurations.</p><button v-for="experiment in experiments" :key="experiment.id" :class="['experiment-item', { selected: selected?.id === experiment.id }]" @click="selectExperiment(experiment.id)"><div class="row"><strong>{{ experiment.snapshot.suite.definition.name }}</strong><span :class="['badge', experiment.status]">{{ experiment.status }}</span></div><p>{{ experiment.snapshot.configurations.length }} configurations · {{ experiment.snapshot.plannedRuns }} runs</p><small>{{ shortId(experiment.id) }} · {{ new Date(experiment.created_at).toLocaleDateString() }}</small></button></section>
            <section v-if="selected" class="results-area">
              <div class="panel result-header"><div><p class="eyebrow">{{ selected.snapshot.suite.definition.split }} suite · {{ shortId(selected.id) }}</p><h2>{{ selected.snapshot.suite.definition.name }}</h2><p v-if="selected.snapshot.evidenceProvenance" class="caption">Saved evidence · {{ selected.snapshot.evidenceProvenance.sourceExperimentId }} · {{ selected.snapshot.graderVersion }} replay</p><p class="caption">{{ completed }} / {{ selected.runs.length }} runs finished <span v-if="live" class="live">● Live</span></p></div><div class="row"><a class="button secondary" :href="`/api/experiments/${selected.id}/export`" download="experiment.json">Export JSON ↗</a><button v-if="selected.status === 'draft'" class="primary" :disabled="busy || readOnly" @click="action('start')">Run experiment</button><button v-if="!terminal(selected.status)" class="secondary" :disabled="busy || readOnly" @click="action('cancel')">Cancel</button><span v-else :class="['badge', selected.status]">{{ selected.status }}</span></div></div>
              <div class="progress-track"><div :style="{ width: `${completed / selected.runs.length * 100}%` }"></div></div>
              <div v-if="results" class="scorecards"><article v-for="(config, index) in results.configurations" :key="config.configurationId" class="panel scorecard"><p class="eyebrow">{{ index === 0 ? 'A · Baseline' : 'B · Candidate' }}</p><h3>{{ configName(config.configurationId) }}</h3><div class="metric">{{ percent(config.passRate) }}<small>task success</small></div><div class="score-bar"><div :class="{ candidate: index === 1 }" :style="{ width: `${(config.passRate ?? 0) * 100}%` }"></div></div><div class="mini-metrics"><span><strong>{{ config.meanScore?.toFixed(1) ?? '—' }}</strong>score</span><span><strong>{{ config.hardFailures }}</strong>hard failures</span><span><strong>{{ config.valid }}/{{ config.planned }}</strong>valid runs</span></div></article></div>
              <article v-if="results?.comparison.candidateId" class="panel verdict"><div><p class="eyebrow">Paired result · B minus A</p><h2 class="capitalize">{{ conclusion }}</h2><p class="caption">{{ results.comparison.validPairs }} / {{ results.comparison.plannedPairs }} pairs · {{ results.comparison.taskClusters }} task clusters</p></div><div class="effect"><strong>{{ points(results.comparison.passDifference) }}</strong><span>95% CI {{ interval ? `${points(interval[0])} to ${points(interval[1])}` : 'not available' }}</span></div><p class="verdict-note">{{ results.comparison.limitedVariation ? 'Limited observed variation. These results do not establish certainty about unseen tasks.' : results.comparison.complete ? 'Whole tasks are resampled together, preserving repeated runs.' : 'Comparison is incomplete. Missing runs are not treated as passes.' }}</p></article>
              <details v-if="diff?.changes.length" class="panel diff"><summary>Configuration differences <span class="count">{{ diff.changes.length }}</span></summary><div v-for="change in diff.changes" :key="change.field"><h4>{{ change.field }}</h4><div class="state-grid"><pre>{{ typeof change.baseline === 'string' ? change.baseline : pretty(change.baseline) }}</pre><pre>{{ typeof change.candidate === 'string' ? change.candidate : pretty(change.candidate) }}</pre></div></div></details>
              <section v-if="results?.comparison.candidateId" class="panel"><div class="panel-title"><h3>Where behavior changed</h3><span class="caption">B minus A · paired tasks</span></div><p v-if="!changedTasks.length" class="empty">No differences observed in the available paired tasks.</p><div v-else class="table-scroll"><table><thead><tr><th>Task</th><th>Category</th><th>Pairs</th><th>Success change</th><th>Score change</th></tr></thead><tbody><tr v-for="task in changedTasks" :key="task.taskId"><td><strong>{{ task.taskId.replaceAll('-',' ') }}</strong></td><td>{{ task.category }}</td><td>{{ task.validPairs }}/{{ task.plannedPairs }}</td><td>{{ points(task.passDifference) }}</td><td>{{ task.scoreDifference?.toFixed(1) }}</td></tr></tbody></table></div></section>
              <label class="run-filter">Run filter<select v-model="runFilter"><option value="all">All runs</option><option value="failures">Failures & missing evidence</option><option value="active">Queued & active</option></select></label>
              <section class="panel"><div class="panel-title"><h3>Run results</h3><span class="caption">Select a run to inspect its evidence ↗</span></div><p v-if="!visibleRuns.length" class="empty">No runs match this filter.</p><div v-else class="table-scroll"><table><thead><tr><th>Task</th><th>Configuration</th><th>Repeat</th><th>Result</th><th>Score</th><th></th></tr></thead><tbody><tr v-for="run in visibleRuns" :key="run.id" tabindex="0" @click="inspectedRun = run.id" @keydown.enter="inspectedRun = run.id"><td><strong>{{ run.task_snapshot.title }}</strong><small>{{ run.task_snapshot.category }}</small></td><td>{{ configName(run.configuration_id) }}</td><td>{{ run.repetition }}</td><td><span :class="['badge', run.grade?.status ?? run.status]">{{ run.grade?.status ?? run.status }}</span></td><td>{{ run.grade?.score ?? '—' }}</td><td><button class="icon-button" aria-label="Inspect run" @click.stop="inspectedRun = run.id">↗</button></td></tr></tbody></table></div></section>
              <details v-if="results" class="panel"><summary>Analysis, coverage & limitations</summary><p class="caption">{{ results.note }}</p><pre>{{ pretty({ ...results.comparison, coverage: results.coverage, categories: results.categories }) }}</pre><p class="caption">Cost unknown. Raw per-turn usage is available in run metadata; provider billing semantics have not been verified.</p></details>
            </section><section v-else class="panel empty">Choose an experiment to explore its results.</section>
          </div>
        </template>
        <template v-else-if="section === 'suites'">
          <header class="page-header"><div><p class="eyebrow">Define the work</p><h1>Task suites</h1><p class="subtitle">Fixtures, expected outcomes, and boundaries—frozen per revision.</p></div><label class="button secondary">Import JSON<input class="visually-hidden" type="file" accept="application/json,.json" :disabled="readOnly" @change="importSuite"></label></header>
          <div class="suite-switcher"><button v-for="suite in suites" :key="suite.id" :class="['panel suite-choice', { selected: selectedSuite?.id === suite.id }]" @click="selectedSuite = suite"><span class="badge">{{ suite.definition.split }}</span><h3>{{ suite.definition.name }}</h3><p>{{ suite.definition.tasks.length }} tasks · revision {{ suite.version }}</p><code>{{ suite.content_hash.slice(0,12) }}</code></button></div>
          <div v-if="selectedSuite" class="task-grid"><article v-for="task in selectedSuite.definition.tasks" :key="task.id" class="panel task-card"><p class="eyebrow">{{ task.category }}</p><h3>{{ task.title }}</h3><p>{{ task.initialAgentInput }}</p><details><summary>Expected outcome & limits</summary><pre>{{ pretty(task) }}</pre></details></article></div>
        </template>
        <template v-else-if="section === 'configurations'">
          <header class="page-header"><div><p class="eyebrow">Change one thing</p><h1>Configurations</h1><p class="subtitle">Every save creates an immutable configuration. Keep experiments interpretable.</p></div></header>
          <div class="config-layout"><section class="panel"><div class="panel-title"><h3>Saved configurations</h3></div><button v-for="config in configs" :key="config.id" class="config-item" @click="configForm = { ...config.definition, name: `${config.definition.name} · copy` }"><strong>{{ config.definition.name }}</strong><small>{{ config.definition.provider }} / {{ config.definition.model }}</small><code>{{ config.content_hash.slice(0,12) }} ↗ copy to editor</code></button></section><form class="panel config-form" @submit.prevent="saveConfiguration"><h2>Create a configuration</h2><label>Name<input v-model="configForm.name" required placeholder="e.g. Recovery procedure v2"></label><div class="state-grid"><label>Provider<input v-model="configForm.provider" required></label><label>Model<input v-model="configForm.model" required></label></div><label>Agent instructions<textarea v-model="configForm.instructions" rows="18" required></textarea></label><p class="caption">CRM tools only · persistent memory disabled · credentials stay on the server.</p><button class="primary" :disabled="busy || readOnly">Save configuration</button></form></div>
        </template>
        <template v-else>
          <header class="page-header"><div><p class="eyebrow">Know what the numbers mean</p><h1>Evidence, not just a score</h1><p class="subtitle">A reproducible protocol for agent behavior and evaluator sensitivity.</p></div></header>
          <div class="method-grid"><article class="panel"><span class="step">01</span><h2>Freeze the comparison</h2><p>Use the same model, fixtures, tools, and grader. Change one prompt or workflow instruction. Pair identical tasks and repetitions, and randomize their order.</p></article><article class="panel"><span class="step">02</span><h2>Grade observable actions</h2><p>Outcome 40%, policy 30%, qualification 20%, workflow 10%. Required assertions must pass. A blocked unsafe attempt still fails; missing evidence is ungradable.</p></article><article class="panel"><span class="step">03</span><h2>Quantify uncertainty</h2><p>10,000 paired bootstrap samples resample whole tasks. A 5 percentage-point practical threshold applies. Missing runs and limited variation keep the result inconclusive.</p></article><article class="panel"><span class="step">04</span><h2>Test the evaluator too</h2><p>Mutate consent, availability, suppression, and confirmations in labeled traces. Check that harmless reads and wording changes preserve scores. Real prompt changes may cause no behavioral change.</p></article></div>
          <div class="panel method-note"><h3>Current boundaries</h3><p>Twenty evaluation cases share ten scenario families. Results describe this synthetic clinic suite, not all businesses. Memory comparisons, semantic privacy judgments, and verified provider billing remain limited. Private model reasoning is neither required nor collected.</p></div>
        </template>
      </div>
    </main>
    <dialog ref="dialog" class="experiment-dialog"><form @submit.prevent="createExperiment"><div class="row"><div><p class="eyebrow">New experiment</p><h2>What changed?</h2></div><button type="button" class="icon-button" aria-label="Close new experiment" @click="dialog?.close()">✕</button></div><p class="caption">Create a draft first. Starting it runs real model calls.</p><label>Task suite<select v-model="suiteId" required><option v-for="suite in suites" :key="suite.id" :value="suite.id">{{ suite.definition.name }}</option></select></label><label>A · Baseline<select v-model="baselineId" required><option v-for="config in configs" :key="config.id" :value="config.id">{{ config.definition.name }}</option></select></label><label>B · Candidate<select v-model="candidateId"><option value="">Single configuration (descriptive only)</option><option v-for="config in configs.filter(c => c.id !== baselineId)" :key="config.id" :value="config.id">{{ config.definition.name }}</option></select></label><label>Repetitions per task<input v-model="repetitions" type="number" min="1" max="5" required></label><button class="primary" :disabled="busy || readOnly">Create draft experiment</button></form></dialog>
    <RunInspector v-if="inspectedRun" :run-id="inspectedRun" @close="inspectedRun = ''" />
  </div>
</template>
