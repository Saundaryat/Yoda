import { computed, toValue, type MaybeRefOrGetter } from 'vue';
import { useRoute, useRouter } from 'vue-router';

// Context is a local review page, never an arbitrary URL or external redirect.
export function reviewReturn(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || value.length > 4096) return fallback;
  if (value === '/' || value === '/?history=1') return value;
  if (
    !/^\/(?:experiments|runs|tasks|configurations)\/[\da-f-]+(?:\/tasks\/[\da-f-]+)?(?:\?[^#]*)?$/i.test(
      value,
    )
  )
    return fallback;
  return value;
}

export function useReviewNavigation(fallback: MaybeRefOrGetter<string>) {
  const route = useRoute();
  const router = useRouter();
  const backTo = computed(() => reviewReturn(route.query.returnTo, toValue(fallback)));
  const backLabel = computed(() => {
    if (backTo.value.startsWith('/runs/')) return 'Back to run';
    if (/^\/experiments\/[^/?]+\/tasks\//.test(backTo.value)) return 'Back to comparison';
    if (backTo.value.startsWith('/experiments/')) return 'Back to experiment';
    return backTo.value === '/configurations' ? 'Configurations' : 'Scenarios';
  });
  function detailLink(path: string) {
    return { path, query: { returnTo: route.fullPath } };
  }
  function goBack(event: MouseEvent) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    if (window.history.state?.back === backTo.value) router.back();
    else void router.push(backTo.value);
  }
  return { backTo, backLabel, detailLink, goBack };
}
