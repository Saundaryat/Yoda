<script setup lang="ts">
import { RouterLink } from 'vue-router';
</script>

<template>
  <div class="guide">
    <header class="guide-head">
      <p class="eyebrow">Product guide</p>
      <h1>How it works</h1>
      <p>Compare two agent versions on the same customer situations, then inspect what changed.</p>
    </header>

    <section class="card" aria-labelledby="workflow-title">
      <h2 id="workflow-title">From a change to evidence</h2>
      <ol class="guide-flow">
        <li>
          <strong>Choose two versions</strong>
          <p>A is the baseline. B is the candidate with the change you want to test.</p>
          <RouterLink to="/configurations">Agent versions →</RouterLink>
        </li>
        <li>
          <strong>Choose scenarios</strong>
          <p>
            Each scenario defines a customer situation, a starting CRM state and checks for expected
            behavior.
          </p>
          <RouterLink to="/tasks">Scenario library →</RouterLink>
        </li>
        <li>
          <strong>Run and compare</strong>
          <p>
            Both versions handle the same scenarios. Compare pass rates, then open a run to inspect
            its conversation, tool calls and grading evidence.
          </p>
          <RouterLink to="/">Browse experiments →</RouterLink>
        </li>
      </ol>
    </section>

    <section class="card" aria-labelledby="runs-title">
      <h2 id="runs-title">What counts as a run?</h2>
      <p>
        A run is one complete agent conversation for one scenario, using one agent version.
        Repetitions give each version several attempts at that scenario.
      </p>
      <div class="formula">
        <span class="eyebrow">Example</span>
        <strong>20 scenarios × 2 versions × 3 repetitions = 120 runs</strong>
        <p>
          The count depends on each experiment’s selected scenarios and repetitions. Its overview
          shows the setup and how many runs finished.
        </p>
      </div>
      <p>
        A finished run can pass or fail. A technical failure or missing grade leaves evidence
        incomplete; finishing every run does not mean every run passed.
      </p>
    </section>

    <section class="card" aria-labelledby="results-title">
      <h2 id="results-title">Reading the result</h2>
      <dl class="guide-definitions">
        <div>
          <dt>Observed result</dt>
          <dd>
            “A scored higher” or “B scored higher” reports which version had the higher pass rate in
            this test. Equal rates show “Same pass rate.”
          </dd>
        </div>
        <div>
          <dt>Confidence &amp; methodology</dt>
          <dd>
            The experiment’s statistical assessment shows its uncertainty range and improvement
            margin. A higher observed score can still have an inconclusive statistical assessment.
          </dd>
        </div>
        <div>
          <dt>Scenarios</dt>
          <dd>
            See which situations improved or regressed. Open individual runs or compare A and B side
            by side to check the supporting evidence.
          </dd>
        </div>
        <div>
          <dt>Metrics &amp; evidence</dt>
          <dd>
            Find the saved setup and hypothesis, detailed metrics, check changes and tool use. Spend
            is an API usage estimate covering the agent, simulated customer and grading.
          </dd>
        </div>
      </dl>
    </section>
  </div>
</template>

<style scoped>
.guide {
  max-width: 960px;
  margin: 0 auto;
}
.guide-head {
  max-width: 700px;
  margin-bottom: 30px;
}
.eyebrow {
  color: var(--muted);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
h1 {
  margin: 8px 0 12px;
}
h2 {
  margin-bottom: 18px;
}
p {
  color: var(--muted);
  line-height: 1.7;
}
.card {
  padding: 26px;
}
.guide-flow {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 30px;
  padding-left: 20px;
  margin-bottom: 0;
}
.guide-flow li {
  padding-left: 4px;
}
.guide-flow li::marker {
  font-weight: 700;
}
.guide-flow strong {
  font-size: 14px;
}
.guide-flow p {
  margin: 12px 0;
}
a {
  color: var(--text);
  text-underline-offset: 4px;
}
.formula {
  padding: 20px;
  margin: 22px 0;
  background: #f8f8f8;
  border-radius: 8px;
}
.formula strong {
  display: block;
  margin: 10px 0;
  font-size: 18px;
}
.formula p {
  margin-bottom: 0;
}
.guide-definitions {
  margin: 0;
}
.guide-definitions > div + div {
  margin-top: 20px;
  padding-top: 20px;
  border-top: 1px solid var(--border);
}
dt {
  font-weight: 650;
  margin-bottom: 6px;
}
dd {
  color: var(--muted);
  line-height: 1.7;
  margin: 0;
}
@media (max-width: 760px) {
  .guide-flow {
    grid-template-columns: 1fr;
    gap: 24px;
  }
  .card {
    padding: 20px;
  }
}
</style>
