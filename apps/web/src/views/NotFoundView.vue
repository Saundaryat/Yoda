<script setup lang="ts">
import { RouterLink } from 'vue-router';
</script>
<template>
  <section class="card empty">
    <p class="page-kicker">Page not found</p>
    <h1>This page does not exist</h1>
    <p>The link may be incomplete or out of date. Your saved experiments are unchanged.</p>
    <RouterLink to="/" class="button">Back to experiments</RouterLink>
  </section>
</template>
