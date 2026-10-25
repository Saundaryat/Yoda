import { onBeforeUnmount, ref, watch, type Ref, type WatchSource } from 'vue';
import { api } from '../api.js';

/** Load JSON from the API, reloading when `path` changes. Keeps the last data while reloading. */
export function useResource<T>(path: WatchSource<string | null> | string) {
  const data = ref<T | null>(null) as Ref<T | null>;
  const error = ref<string | null>(null);
  const loading = ref(false);
  let current: string | null = null;
  let generation = 0;

  async function load(target: string | null = current) {
    const request = ++generation;
    if (target !== current) data.value = null;
    current = target;
    error.value = null;
    if (!target) {
      data.value = null;
      loading.value = false;
      return;
    }
    loading.value = true;
    try {
      const next = await api<T>(target);
      if (request === generation) data.value = next;
    } catch (e) {
      if (request === generation) error.value = (e as Error).message;
    } finally {
      if (request === generation) loading.value = false;
    }
  }

  if (typeof path === 'string') void load(path);
  else watch(path, (next) => void load(next), { immediate: true });
  onBeforeUnmount(() => {
    generation++;
  });
  return { data, error, loading, reload: () => load() };
}
