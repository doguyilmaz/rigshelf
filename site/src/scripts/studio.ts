import type { RigController } from './rig-renderer';
import { type HarnessKey, harnesses, library, type ProjectKey, projects } from './studio-data';

const stage = document.querySelector<HTMLElement>('[data-rig-stage]')!;
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
let controller: RigController | undefined,
  loading: Promise<void> | undefined,
  failed = false,
  destroyed = false;
let selected: ProjectKey = 'expo',
  expanded = false,
  visible = true,
  fallbackTurn = 0;

function animateFallback(animate: boolean): void {
  for (const [index, part] of [
    ...stage.querySelectorAll<SVGGElement>('[data-static-part]'),
  ].entries()) {
    const previous = getComputedStyle(part).transform;
    for (const animation of part.getAnimations()) animation.cancel();
    const transform = expanded ? `translateY(${-25 - index * 8}px)` : 'translateY(0px)';
    if (animate && !reduced.matches)
      part.animate([{ transform: previous }, { transform }], {
        duration: 900,
        easing: 'cubic-bezier(.23,1,.32,1)',
      });
    part.style.transform = transform;
  }
}

async function loadRig(): Promise<void> {
  if (controller || failed || destroyed) return;
  if (!loading)
    loading = (async () => {
      const canvas = stage.querySelector<HTMLCanvasElement>('canvas')!;
      try {
        const context = canvas.getContext('webgl2', {
          alpha: true,
          antialias: true,
          powerPreference: 'low-power',
        });
        if (!context) {
          failed = true;
          return;
        }
        const { createRig } = await import('./rig-renderer');
        await document.fonts.ready;
        const rig = await createRig(canvas, stage, () => reduced.matches);
        if (destroyed) {
          rig.destroy();
          return;
        }
        controller = rig;
        stage.dataset.renderer = 'webgl';
        rig.project(selected, false);
        if (!expanded && !reduced.matches) {
          rig.explode(true, false);
          rig.explode(false, true);
        } else rig.explode(expanded, false);
        rig.visible(visible);
        document.querySelector('[data-rig-instruction]')!.textContent =
          'Drag to inspect · choose a project';
      } catch {
        failed = true;
        stage.dataset.renderer = 'static';
      }
    })();
  await loading;
}

function updateProject(key: ProjectKey, animate: boolean): void {
  selected = key;
  expanded = false;
  document.querySelectorAll<HTMLButtonElement>('[data-rig-project]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.rigProject === key));
  });
  document.querySelector('[data-rig-motion-label]')!.textContent =
    `Assembled for ${projects[key].name}`;
  document.querySelector('[data-rig-split]')!.setAttribute('aria-pressed', 'false');
  stage.dataset.exploded = 'false';
  if (controller) controller.project(key, animate);
  else animateFallback(animate);
}

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-rig-project]'))
  button.addEventListener('click', (event) => {
    const key = button.dataset.rigProject;
    if (key && Object.hasOwn(projects, key))
      updateProject(key as ProjectKey, event.detail > 0 && !reduced.matches);
  });
document.querySelector('[data-rig-split]')?.addEventListener('click', (event) => {
  expanded = !expanded;
  stage.dataset.exploded = String(expanded);
  document.querySelector('[data-rig-split]')!.setAttribute('aria-pressed', String(expanded));
  if (controller) controller.explode(expanded, (event as MouseEvent).detail > 0);
  else animateFallback((event as MouseEvent).detail > 0);
  if (!reduced.matches) void loadRig();
});
document.querySelector('[data-rig-rotate]')?.addEventListener('click', async (event) => {
  if (!reduced.matches) await loadRig();
  if (controller) controller.rotate((event as MouseEvent).detail > 0);
  else {
    fallbackTurn = fallbackTurn ? 0 : 12;
    stage.querySelector<SVGElement>('.stage-fallback')!.style.transform =
      `perspective(900px) rotateY(${fallbackTurn}deg)`;
  }
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
    document.querySelector('[data-native-note]')!.textContent =
      key === 'claude'
        ? 'Skills retain supporting files. Claude guidance can reference shared AGENTS.md.'
        : 'Skills retain supporting files. Native configuration is used where supported; a local bridge covers documented MCP gaps.';
    document.querySelector('[data-native-status]')!.textContent =
      `${harness.name} selected. Example paths only; nothing is installed.`;
  });

const observer = new IntersectionObserver(
  (entries) => {
    visible = entries.some((entry) => entry.isIntersecting);
    controller?.visible(visible && !document.hidden);
    if (visible && !reduced.matches) void loadRig();
  },
  { threshold: 0.08 },
);
observer.observe(stage);
reduced.addEventListener('change', () => {
  if (reduced.matches) {
    controller?.stopMotion();
    for (const animation of stage.getAnimations({ subtree: true })) animation.cancel();
  } else if (visible) void loadRig();
});
document.addEventListener('visibilitychange', () =>
  controller?.visible(visible && !document.hidden),
);
stage.querySelector('canvas')?.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  controller?.destroy();
  controller = undefined;
  failed = true;
  stage.dataset.renderer = 'static';
  stage.dataset.moving = 'false';
});
window.addEventListener('pagehide', (event) => {
  if (event.persisted) {
    controller?.visible(false);
    return;
  }
  destroyed = true;
  observer.disconnect();
  controller?.destroy();
});
window.addEventListener('pageshow', () => controller?.visible(visible && !document.hidden));
