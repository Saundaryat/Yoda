import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router.js';
import './styles.css';
import './styles/polish.css';
import './styles/evidence.css';
import './styles/setup.css';

createApp(App).use(router).mount('#app');
