import type { ProgressEvent } from '@evals/shared';
import { onBeforeUnmount, watch, type Ref } from 'vue';

/** Events are invalidation hints. Reload authoritative state on every connection, including reconnects. */
export function useExperimentEvents(
  id: Ref<string>,
  onEvent: (event: ProgressEvent | null) => void,
) {
  let source: EventSource | null = null;
  const close = () => {
    source?.close();
    source = null;
  };
  watch(
    id,
    (experimentId) => {
      close();
      if (!experimentId) return;
      source = new EventSource(`/api/experiments/${experimentId}/events`);
      source.onopen = () => onEvent(null);
      source.onmessage = (message) => onEvent(JSON.parse(message.data) as ProgressEvent);
    },
    { immediate: true },
  );
  onBeforeUnmount(close);
}
