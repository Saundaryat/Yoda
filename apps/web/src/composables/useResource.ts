import { ref, watch, type Ref, type WatchSource } from 'vue';
import { api } from '../api.js';

/** Load JSON from the API, reloading when `path` changes. Keeps the last data while reloading. */
export function useResource<T>(path: WatchSource<string | null> | string) {
  const data = ref<T | null>(null) as Ref<T | null>;
  const error = ref<string | null>(null);
  const loading = ref(false);
  let current: string | null = null;

  async function load(target: string | null = current) {
    current = target;
    if (!target) return;
    loading.value = true;
    try {
      data.value = await api<T>(target);
      error.value = null;
    } catch (e) {
      error.value = (e as Error).message;
    } finally {
      loading.value = false;
    }
  }

  if (typeof path === 'string') void load(path);
  else watch(path, (next) => void load(next), { immediate: true });
  return { data, error, loading, reload: () => load() };
}
