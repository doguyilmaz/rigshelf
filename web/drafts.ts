import { useEffect, useId } from 'react';

const drafts = new Map<string, string>();
export interface DiscardRequest {
  labels: string[];
  proceed: () => void;
}
export function requestDiscard(action: () => void, key?: string): void {
  const ids = [...drafts.keys()].filter((id) => key === undefined || id === key);
  if (!ids.length) {
    action();
    return;
  }
  window.dispatchEvent(
    new CustomEvent<DiscardRequest>('kitfold-discard', {
      detail: {
        labels: [...new Set(ids.map((id) => drafts.get(id)!))],
        proceed: action,
      },
    }),
  );
}
export function useDraftGuard(dirty: boolean, label: string): (action: () => void) => void {
  const id = useId();
  useEffect(() => {
    if (dirty) drafts.set(id, label);
    else drafts.delete(id);
    return () => {
      drafts.delete(id);
    };
  }, [id, dirty, label]);
  return (action) => requestDiscard(action, id);
}
window.addEventListener('beforeunload', (event) => {
  if (drafts.size) {
    event.preventDefault();
    event.returnValue = '';
  }
});
