import { createRouter, createWebHistory } from 'vue-router';

export const router = createRouter({
  history: createWebHistory(),
  scrollBehavior: (_to, _from, saved) => saved ?? { top: 0 },
  routes: [
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: () => import('./views/NotFoundView.vue'),
    },
    {
      path: '/how-it-works',
      name: 'how-it-works',
      component: () => import('./views/HowItWorksView.vue'),
    },
    { path: '/', name: 'experiments', component: () => import('./views/ExperimentsView.vue') },
    {
      path: '/experiments/new',
      name: 'new-experiment',
      component: () => import('./views/NewExperimentView.vue'),
    },
    {
      path: '/experiments/:id',
      name: 'experiment',
      component: () => import('./views/ExperimentView.vue'),
      props: true,
    },
    {
      path: '/experiments/:id/tasks/:taskId',
      name: 'compare',
      component: () => import('./views/CompareView.vue'),
      props: true,
    },
    { path: '/runs/:id', name: 'run', component: () => import('./views/RunView.vue'), props: true },
    { path: '/tasks', name: 'tasks', component: () => import('./views/TasksView.vue') },
    {
      path: '/tasks/:id',
      name: 'task',
      component: () => import('./views/TaskView.vue'),
      props: true,
    },
    {
      path: '/configurations',
      name: 'configurations',
      component: () => import('./views/ConfigurationsView.vue'),
    },
    {
      path: '/configurations/new',
      name: 'new-configuration',
      component: () => import('./views/NewConfigurationView.vue'),
    },
    {
      path: '/configurations/:id',
      name: 'configuration',
      component: () => import('./views/ConfigurationView.vue'),
      props: true,
    },
  ],
});

// A long-lived tab may reference chunks removed by a local rebuild. Recover once
// with the new app shell, keeping the destination rather than leaving a dead link.
const chunkRecoveryKey = 'evals:chunk-recovery';
router.onError((error, to) => {
  if (
    !/Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(
      String(error),
    )
  )
    return;
  if (sessionStorage.getItem(chunkRecoveryKey) === to.fullPath) return;
  sessionStorage.setItem(chunkRecoveryKey, to.fullPath);
  window.location.assign(to.fullPath);
});
router.afterEach((_to, _from, failure) => {
  if (!failure) sessionStorage.removeItem(chunkRecoveryKey);
});
