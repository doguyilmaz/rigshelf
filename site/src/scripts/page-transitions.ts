export {};

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let keyboardNavigation = false;
document.addEventListener(
  'keydown',
  () => {
    keyboardNavigation = true;
  },
  { capture: true },
);
document.addEventListener(
  'pointerdown',
  () => {
    keyboardNavigation = false;
  },
  { capture: true, passive: true },
);
window.addEventListener('pageswap', (event) => {
  if (keyboardNavigation || reducedMotion.matches) event.viewTransition?.skipTransition();
});
window.addEventListener('pageshow', () => {
  keyboardNavigation = false;
});
