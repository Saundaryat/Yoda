import type { ProgressEvent } from '@evals/shared';
import { onBeforeUnmount, watch, type Ref } from 'vue';

/** Call `onEvent` for every run state change of the experiment (server-sent events). */
export function useExperimentEvents(id: Ref<string>, onEvent: (event: ProgressEvent) => void) {
  let source: EventSource | null = null;
  const close = () => {
    source?.close();
    source = null;
  };
  watch(
    id,
    (experimentId) => {
      close();
      source = new EventSource(`/api/experiments/${experimentId}/events`);
      source.onmessage = (message) => onEvent(JSON.parse(message.data) as ProgressEvent);
    },
    { immediate: true },
  );
  onBeforeUnmount(close);
}
