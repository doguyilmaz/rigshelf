import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';

const Presence = createContext<{ exiting: boolean; finish: () => void } | null>(null);

/** Retain the current editor until its dialog finishes leaving the top layer. */
export function ModalPresence({ children }: { children: ReactNode }): ReactNode {
  const [retained, setRetained] = useState(children);
  useLayoutEffect(() => {
    if (children) setRetained(children);
  }, [children]);
  const finish = useCallback(() => setRetained(null), []);
  const value = useMemo(() => ({ exiting: !children, finish }), [children, finish]);
  return children || retained ? (
    <Presence.Provider value={value}>{children || retained}</Presence.Provider>
  ) : null;
}

export function useModalPresence() {
  return useContext(Presence);
}
