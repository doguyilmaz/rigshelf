import type { RigController } from './rig-renderer';
import { type HarnessKey, harnesses, library, type ProjectKey, projects } from './studio-data';

const stage = document.querySelector<HTMLElement>('[data-rig-stage]')!;
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const rotateButton = document.querySelector<HTMLButtonElement>('[data-rig-rotate]')!;
const searchDialog = document.querySelector<HTMLDialogElement>('#doc-search')!;
let controller: RigController | undefined, loading: Promise<void> | undefined;
let failed = false,
  destroyed = false,
  selected: ProjectKey = 'expo';
let expanded = false,
  visible = true,
  obscured = searchDialog.open;
let rotationSteps = 0,
  rotationRequested = false;
let commandPending = false;
const canDraw = (): boolean => visible && !document.hidden && !obscured;

function refreshCaption(): void {
  document.querySelector('[data-rig-motion-label]')!.textContent =
    commandPending && !failed
      ? 'Preparing the 3D view…'
      : expanded
        ? `Layers separated for ${projects[selected].name}`
        : `Assembled for ${projects[selected].name}`;
}

function animateFallback(animate: boolean): void {
  for (const [index, part] of [
    ...stage.querySelectorAll<SVGGElement>('[data-static-part]'),
  ].entries()) {
    const previous = getComputedStyle(part).transform;
    for (const animation of part.getAnimations()) animation.cancel();
    const transform = expanded ? `translateY(${-25 - index * 8}px)` : 'translateY(0px)';
    if (animate && !reduced.matches && canDraw())
      part.animate([{ transform: previous }, { transform }], {
        duration: 700,
        easing: 'cubic-bezier(.23,1,.32,1)',
      });
    part.style.transform = transform;
  }
}

function unavailable(): void {
  failed = true;
  rotateButton.removeAttribute('aria-busy');
  rotateButton.disabled = true;
  rotateButton.title = '3D rotation is unavailable in this browser';
  document.querySelector('[data-rig-instruction]')!.textContent =
    '3D rotation is unavailable here.';
  animateFallback(false);
}

async function prepareRig(): Promise<void> {
  const canvas = stage.querySelector<HTMLCanvasElement>('canvas')!;
  try {
    if (
      !canvas.getContext('webgl2', { alpha: true, antialias: true, powerPreference: 'low-power' })
    ) {
      unavailable();
      return;
    }
    const { createRig } = await import('./rig-renderer');
    await document.fonts.ready;
    if (destroyed || obscured) return;
    const rig = await createRig(canvas, stage, () => reduced.matches);
    if (destroyed || failed) {
      rig.destroy();
      return;
    }
    rig.visible(false);
    rig.project(selected, false);
    rig.explode(expanded, false);
    for (let step = 0; step < rotationSteps; step++) rig.rotate(false);
    controller = rig;
    rig.visible(canDraw());
    stage.dataset.renderer = 'webgl';
    document.querySelector('[data-rig-instruction]')!.textContent = matchMedia(
      '(hover: hover) and (pointer: fine)',
    ).matches
      ? 'Drag the rig or use the controls.'
      : 'Use the controls to explore the rig.';
  } catch {
    stage.dataset.renderer = 'static';
    unavailable();
  }
}

async function loadRig(explicit = false): Promise<void> {
  if (controller || failed || destroyed || obscured) return;
  if (!explicit && (!visible || (reduced.matches && !rotationRequested))) return;
  if (explicit) {
    commandPending = true;
    refreshCaption();
  }
  if (!loading) {
    rotateButton.setAttribute('aria-busy', 'true');
    loading = prepareRig().finally(() => {
      loading = undefined;
      commandPending = false;
      refreshCaption();
      rotateButton.removeAttribute('aria-busy');
    });
  }
  await loading;
}

async function updateProject(key: ProjectKey, animate: boolean): Promise<void> {
  selected = key;
  expanded = false;
  rotationSteps = 0;
  document.querySelectorAll<HTMLButtonElement>('[data-rig-project]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.rigProject === key));
  });
  refreshCaption();
  document.querySelector('[data-rig-split]')!.setAttribute('aria-pressed', 'false');
  stage.dataset.exploded = 'false';
  if (controller) controller.project(key, animate);
  else {
    if (!reduced.matches) await loadRig(true);
    if (!controller) animateFallback(animate);
  }
}

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-rig-project]'))
  button.addEventListener('click', (event) => {
    const key = button.dataset.rigProject;
    if (key && Object.hasOwn(projects, key))
      void updateProject(key as ProjectKey, event.detail > 0 && !reduced.matches);
  });
document.querySelector('[data-rig-split]')!.addEventListener('click', async (event) => {
  expanded = !expanded;
  stage.dataset.exploded = String(expanded);
  refreshCaption();
  document.querySelector('[data-rig-split]')!.setAttribute('aria-pressed', String(expanded));
  const animate = (event as MouseEvent).detail > 0;
  if (controller) controller.explode(expanded, animate);
  else {
    if (!reduced.matches) await loadRig(true);
    if (!controller) animateFallback(animate);
  }
});
rotateButton.addEventListener('click', async (event) => {
  rotationRequested = true;
  rotationSteps = (rotationSteps + 1) % 4;
  if (controller) controller.rotate(event.detail > 0);
  else await loadRig(true);
});

function contextProject(key: ProjectKey): void {
  const project = projects[key];
  document.querySelectorAll<HTMLButtonElement>('[data-context-project]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.contextProject === key));
  });
  for (const [index, item] of library.entries())
    document
      .querySelector(`[data-library-index="${index}"]`)
      ?.classList.toggle('is-selected', (item.projects as readonly string[]).includes(key));
  document.querySelector('[data-context-name]')!.textContent = project.name;
  document.querySelector('[data-context-stack]')!.textContent = project.stack;
  document.querySelector('[data-context-number]')!.textContent = `PROJECT / ${project.number}`;
  const list = document.querySelector('[data-context-selection]')!;
  list.replaceChildren();
  for (const [index, name] of [...project.skills, 'Project docs', project.directive].entries()) {
    const item = document.createElement('li'),
      type = document.createElement('span');
    type.textContent = index < 2 ? 'S' : index === 2 ? 'M' : 'R';
    item.append(type, document.createTextNode(name));
    list.append(item);
  }
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-context-project]'))
  button.addEventListener('click', () => {
    const key = button.dataset.contextProject;
    if (key && Object.hasOwn(projects, key)) contextProject(key as ProjectKey);
  });
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-native-harness]'))
  button.addEventListener('click', () => {
    const key = button.dataset.nativeHarness;
    if (!key || !Object.hasOwn(harnesses, key)) return;
    const harness = harnesses[key as HarnessKey];
    document.querySelectorAll<HTMLButtonElement>('[data-native-harness]').forEach((item) => {
      item.setAttribute('aria-pressed', String(item === button));
    });
    document.querySelector('[data-native-skills]')!.textContent = harness.skill;
    document.querySelector('[data-native-mcp]')!.textContent = harness.mcp;
    document.querySelector('[data-native-guidance]')!.textContent = harness.guidance;
    document.querySelector('[data-native-current]')!.textContent =
      `${harness.name.toUpperCase()} / PROJECT SCOPE`;
    document.querySelector('[data-native-status]')!.textContent =
      `${harness.name} selected. Example paths only; nothing is installed.`;
  });

function syncVisibility(): void {
  controller?.visible(canDraw());
  if (canDraw()) void loadRig();
}
const observer = new IntersectionObserver(
  (entries) => {
    visible = entries.some((entry) => entry.isIntersecting);
    syncVisibility();
  },
  { threshold: 0.08 },
);
observer.observe(stage);
const overlayObserver = new MutationObserver(() => {
  obscured = searchDialog.open;
  syncVisibility();
});
overlayObserver.observe(searchDialog, { attributes: true, attributeFilter: ['open'] });
reduced.addEventListener('change', () => {
  if (reduced.matches) {
    controller?.stopMotion();
    for (const animation of stage.getAnimations({ subtree: true })) animation.cancel();
    if (!controller) animateFallback(false);
  } else syncVisibility();
});
document.addEventListener('visibilitychange', syncVisibility);
stage.querySelector('canvas')!.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  controller?.destroy();
  controller = undefined;
  stage.dataset.renderer = 'static';
  stage.dataset.moving = 'false';
  unavailable();
});
window.addEventListener('pagehide', (event) => {
  if (event.persisted) {
    controller?.visible(false);
    return;
  }
  destroyed = true;
  observer.disconnect();
  overlayObserver.disconnect();
  controller?.destroy();
});
window.addEventListener('pageshow', syncVisibility);
