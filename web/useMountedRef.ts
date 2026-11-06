import { useLayoutEffect, useRef } from 'react';

/** Keeps a completed mutation from changing a replacement editor's parent state. */
export function useMountedRef() {
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}
