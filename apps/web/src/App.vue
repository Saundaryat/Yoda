<script setup lang="ts">
import type { HealthStatus } from '@evals/shared';
import { RouterLink, RouterView, useRoute } from 'vue-router';
import { useResource } from './composables/useResource.js';

const { data: health } = useResource<HealthStatus>('/health');
const route = useRoute();
</script>

<template>
  <div class="app-shell">
    <a href="#main-content" class="skip-link">Skip to content</a>
    <aside class="rail">
      <RouterLink to="/" class="wordmark" aria-label="Tracework home">T</RouterLink>
      <nav aria-label="Primary navigation">
        <RouterLink
          to="/"
          title="Experiments"
          aria-label="Experiments"
          :class="{
            'section-active':
              route.path === '/' ||
              route.path.startsWith('/experiments') ||
              route.path.startsWith('/runs'),
          }"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 19V9m5 10V5m5 14v-7m5 7V3" />
          </svg>
        </RouterLink>
        <RouterLink to="/tasks" title="Scenarios" aria-label="Scenarios">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8 6h12M8 12h12M8 18h12M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
          </svg>
        </RouterLink>
        <RouterLink to="/configurations" title="Configurations" aria-label="Configurations">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path
              d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-2.9 1.21V21h-4v-.08a1.7 1.7 0 0 0-2.9-1.21l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 3.08 14H3v-4h.08A1.7 1.7 0 0 0 4.29 7.1l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 10 3.08V3h4v.08a1.7 1.7 0 0 0 2.9 1.21l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 20.92 10H21v4h-.08A1.7 1.7 0 0 0 19.4 15Z"
            />
          </svg>
        </RouterLink>
      </nav>
      <div class="rail-bottom">
        <span
          class="health-dot"
          :class="{ online: health }"
          :title="health ? 'System online' : 'Connecting'"
        />
      </div>
    </aside>

    <header class="topbar">
      <div class="product-title">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M8 4v16" />
        </svg>
        <strong>Agent evaluations</strong>
      </div>
      <div class="environment">
        <span
          ><i :class="{ online: health }" />{{ health ? 'Local environment' : 'Connecting…' }}</span
        >
        <b aria-label="User profile">L</b>
      </div>
    </header>

    <main id="main-content" class="workspace" tabindex="-1">
      <div class="page" :class="{ 'experiments-page': route.path === '/' }">
        <nav
          v-if="['/', '/configurations', '/tasks'].includes(route.path)"
          class="workflow"
          aria-label="Evaluation workflow"
        >
          <RouterLink to="/configurations">1. Agent versions</RouterLink
          ><span aria-hidden="true">→</span> <RouterLink to="/tasks">2. Scenarios</RouterLink
          ><span aria-hidden="true">→</span>
          <RouterLink to="/">3. Experiments &amp; results</RouterLink>
        </nav>
        <RouterView
          :key="
            route.path + (route.name === 'new-configuration' ? JSON.stringify(route.query) : '')
          "
        />
      </div>
    </main>
  </div>
</template>

<style scoped>
.workflow {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 5px;
  border: 1px solid #ededed;
  border-radius: 10px;
  background: #f8f8f8;
  margin-bottom: 24px;
  font-size: 11px;
}
.workflow a {
  display: inline;
  width: auto;
  height: auto;
  padding: 8px 10px;
  border-radius: 6px;
  color: #666;
  text-decoration: none;
}
.workflow a.router-link-exact-active {
  background: #fff;
  color: #171717;
  box-shadow: 0 1px 4px #0000000d;
}
.workflow > span {
  color: #aaa;
}
.page.experiments-page {
  max-width: 1280px;
}
.app-shell {
  min-height: 100vh;
}
.rail {
  position: fixed;
  inset: 0 auto 0 0;
  z-index: 30;
  width: 72px;
  display: flex;
  flex-direction: column;
  align-items: center;
  background: #fff;
  border-right: 1px solid #e8e8e8;
}
.wordmark {
  width: 36px;
  height: 36px;
  margin: 18px 0 25px;
  display: grid;
  place-items: center;
  color: #fff;
  background: #171717;
  border-radius: 7px;
  font-size: 17px;
  font-weight: 750;
  text-decoration: none;
}
nav {
  display: grid;
  gap: 10px;
}
nav a {
  width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  color: #222;
  border-radius: 8px;
}
nav a:hover {
  background: #f5f5f5;
}
nav a.router-link-exact-active,
nav a.section-active,
nav a.router-link-active:not([href='/']) {
  background: #eeeeee;
}
nav svg,
.product-title svg {
  width: 20px;
  height: 20px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.rail-bottom {
  width: 100%;
  margin-top: auto;
  padding: 20px 0;
  display: grid;
  place-items: center;
  border-top: 1px solid #e8e8e8;
}
.health-dot {
  width: 9px;
  height: 9px;
  background: #bbb;
  border: 2px solid #fff;
  border-radius: 50%;
  box-shadow: 0 0 0 1px #bbb;
}
.health-dot.online {
  background: #171717;
  box-shadow: 0 0 0 1px #171717;
}
.topbar {
  position: fixed;
  inset: 0 0 auto 72px;
  z-index: 20;
  height: 72px;
  padding: 0 24px 0 34px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: rgba(255, 255, 255, 0.96);
  border-bottom: 1px solid #e8e8e8;
  backdrop-filter: blur(10px);
}
.product-title {
  display: flex;
  align-items: center;
  gap: 16px;
}
.product-title strong {
  font-size: 16px;
  letter-spacing: -0.01em;
}
.environment {
  display: flex;
  align-items: center;
  gap: 18px;
  color: #737373;
  font-size: 12px;
}
.environment span {
  display: flex;
  align-items: center;
  gap: 7px;
}
.environment i {
  width: 6px;
  height: 6px;
  background: #bbb;
  border-radius: 50%;
}
.environment i.online {
  background: #171717;
}
.environment b {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  color: #fff;
  background: #171717;
  border-radius: 50%;
  font-size: 12px;
}
.workspace {
  min-height: 100vh;
  margin-left: 72px;
  padding-top: 72px;
}
@media (max-width: 640px) {
  .rail {
    inset: auto 0 0 0;
    width: auto;
    height: 58px;
    flex-direction: row;
    justify-content: center;
    border: 0;
    border-top: 1px solid #e8e8e8;
  }
  .wordmark,
  .rail-bottom {
    display: none;
  }
  .rail nav {
    display: flex;
    gap: 18px;
  }
  .rail nav a {
    width: 44px;
    height: 40px;
  }
  .topbar {
    inset: 0 0 auto 0;
    height: 58px;
    padding: 0 16px;
  }
  .product-title {
    gap: 10px;
  }
  .product-title strong {
    font-size: 14px;
  }
  .environment span {
    display: none;
  }
  .environment b {
    width: 30px;
    height: 30px;
  }
  .workspace {
    margin-left: 0;
    padding: 58px 0 68px;
  }
}
</style>
