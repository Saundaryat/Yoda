<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router';
</script>

<template>
  <header class="topbar">
    <RouterLink to="/" class="brand">Agent Evals</RouterLink>
  </header>
  <main class="page">
    <RouterView />
  </main>
</template>
