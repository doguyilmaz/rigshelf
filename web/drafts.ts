import { useEffect, useId } from 'react';

const drafts = new Map<string, { label: string; retainOnNavigate: boolean }>();
export interface DiscardRequest {
  labels: string[];
  proceed: () => void;
}
export function requestDiscard(action: () => void, key?: string): void {
  const ids = [...drafts.keys()].filter((id) =>
    key === undefined ? !drafts.get(id)!.retainOnNavigate : id === key,
  );
  if (!ids.length) {
    action();
    return;
  }
  window.dispatchEvent(
    new CustomEvent<DiscardRequest>('kitfold-discard', {
      detail: {
        labels: [...new Set(ids.map((id) => drafts.get(id)!.label))],
        proceed: action,
      },
    }),
  );
}
export function useDraftGuard(
  dirty: boolean,
  label: string,
  options: { retainOnNavigate?: boolean } = {},
): (action: () => void) => void {
  const id = useId();
  const retainOnNavigate = options.retainOnNavigate ?? false;
  useEffect(() => {
    if (dirty) drafts.set(id, { label, retainOnNavigate });
    else drafts.delete(id);
    return () => {
      drafts.delete(id);
    };
  }, [id, dirty, label, retainOnNavigate]);
  return (action) => requestDiscard(action, id);
}
window.addEventListener('beforeunload', (event) => {
  if (drafts.size) {
    event.preventDefault();
    event.returnValue = '';
  }
});
