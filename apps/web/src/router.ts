import { createRouter, createWebHistory } from 'vue-router';

export const router = createRouter({
  history: createWebHistory(),
  scrollBehavior: (_to, _from, saved) => saved ?? { top: 0 },
  routes: [
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
  ],
});
