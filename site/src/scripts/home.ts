export {};

const examples = {
  expo: {
    name: 'Fieldnotes',
    stack: 'Expo · React Native · TypeScript',
    skills: ['React Native practices', 'Native UI patterns'],
    rule: 'Your mobile conventions',
  },
  web: {
    name: 'Papertrail',
    stack: 'React · TypeScript · Web',
    skills: ['React composition', 'Web accessibility'],
    rule: 'Your web conventions',
  },
  api: {
    name: 'Relay',
    stack: 'Bun · Hono · TypeScript',
    skills: ['API conventions', 'Auth patterns'],
    rule: 'Your backend conventions',
  },
} as const;
type Project = keyof typeof examples;
type Harness = 'claude' | 'codex';
const bench = document.querySelector<HTMLElement>('[data-workbench]')!;
let project: Project = 'expo';
let harness: Harness = 'claude';
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

function render(): void {
  const selected = examples[project];
  bench.querySelector('[data-project-name]')!.textContent = selected.name;
  bench.querySelector('[data-project-stack]')!.textContent = selected.stack;
  const names = [...selected.skills, 'Project docs', selected.rule];
  const titles = bench.querySelectorAll('[data-kit-list] strong');
  titles.forEach((title, index) => {
    title.textContent = names[index] || '';
  });
  for (const button of bench.querySelectorAll<HTMLButtonElement>('[data-project]'))
    button.setAttribute('aria-pressed', String(button.dataset.project === project));
  for (const button of bench.querySelectorAll<HTMLButtonElement>('[data-harness]'))
    button.setAttribute('aria-pressed', String(button.dataset.harness === harness));
  bench.querySelector('[data-file-name]')!.textContent =
    harness === 'claude' ? '.mcp.json' : '.codex/config.toml';
  bench.querySelector('[data-skill-path]')!.textContent =
    harness === 'claude' ? '.claude/skills/' : '.agents/skills/';
  bench.querySelector('[data-file-code]')!.textContent =
    harness === 'claude'
      ? JSON.stringify(
          { mcpServers: { 'project-docs': { type: 'http', url: 'https://example.test/mcp' } } },
          null,
          2,
        )
      : '[mcp_servers.project-docs]\nurl = "https://example.test/mcp"\n\n# Skills\n# .agents/skills/<name>/SKILL.md\n\n# Guidance\n# AGENTS.md';
  bench.querySelector('[data-example-status]')!.textContent =
    `${selected.name} → ${harness === 'claude' ? 'Claude' : 'Codex'}. Review the exact files before Apply.`;
}

for (const button of bench.querySelectorAll<HTMLButtonElement>('[data-project]')) {
  button.addEventListener('click', () => {
    if (!(button.dataset.project! in examples)) return;
    project = button.dataset.project as Project;
    render();
  });
}
for (const button of bench.querySelectorAll<HTMLButtonElement>('[data-harness]')) {
  button.addEventListener('click', () => {
    harness = button.dataset.harness === 'codex' ? 'codex' : 'claude';
    render();
  });
}

function assemble(): void {
  if (reduceMotion.matches) return;
  document.querySelectorAll<SVGGElement>('.rig-art [data-part]').forEach((part, index) => {
    for (const animation of part.getAnimations()) animation.cancel();
    part.animate(
      [
        { transform: 'translateY(-32px)', opacity: 0.15 },
        { transform: 'translateY(0)', opacity: 1 },
      ],
      {
        duration: 900,
        delay: index * 80,
        easing: 'cubic-bezier(.23,1,.32,1)',
        fill: 'backwards',
      },
    );
  });
}
document.querySelector('[data-replay]')?.addEventListener('click', assemble);
if ('IntersectionObserver' in window) {
  const art = document.querySelector('.rig-art')!;
  const observer = new IntersectionObserver(
    (items) => {
      if (items.some((item) => item.isIntersecting)) {
        assemble();
        observer.disconnect();
      }
    },
    { threshold: 0.3 },
  );
  observer.observe(art);
}
reduceMotion.addEventListener('change', () => {
  if (reduceMotion.matches)
    for (const animation of document.querySelector('.rig-art')!.getAnimations({ subtree: true }))
      animation.cancel();
});
