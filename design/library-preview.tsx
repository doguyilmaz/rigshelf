import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Entry } from '../src/core/model';
import type { AppState } from '../web/api';
import type { DiscardRequest } from '../web/drafts';
import { Library } from '../web/pages/Library';
import '../web/styles.css';
import '../web/neutral.css';

const rows: {
  name: string;
  description: string;
  tags: string[];
  kind: Entry['kind'];
  sourceId: string;
}[] = [
  {
    name: 'expo-auth-flow',
    description: 'Add sign-in and session handling to an Expo app.',
    tags: ['expo', 'better-auth'],
    kind: 'skill',
    sourceId: 'mobile',
  },
  {
    name: 'react-native-performance',
    description: 'Investigate slow renders and reduce unnecessary work.',
    tags: ['react-native', 'performance'],
    kind: 'skill',
    sourceId: 'mobile',
  },
  {
    name: 'swiftui-accessibility',
    description: 'Review VoiceOver, dynamic type and keyboard interaction.',
    tags: ['swiftui', 'ios', 'accessibility'],
    kind: 'skill',
    sourceId: 'apple',
  },
  {
    name: 'hono-auth-api',
    description: 'Build a typed authentication API with Hono and Better Auth.',
    tags: ['hono', 'better-auth', 'typescript'],
    kind: 'skill',
    sourceId: 'backend',
  },
  {
    name: 'react-native-testing',
    description: 'Test user interactions and navigation behavior.',
    tags: ['react-native', 'testing'],
    kind: 'skill',
    sourceId: 'mobile',
  },
  {
    name: 'expo-release-checklist',
    description: 'Prepare a mobile release and review signing settings.',
    tags: ['expo', 'deployment'],
    kind: 'skill',
    sourceId: 'mobile',
  },
  {
    name: 'macos-window-layout',
    description: 'Organize windows and keyboard shortcuts in a macOS app.',
    tags: ['macos', 'swiftui', 'design'],
    kind: 'skill',
    sourceId: 'apple',
  },
  {
    name: 'nextjs-data-fetching',
    description: 'Choose caching and data-fetching boundaries for the web.',
    tags: ['nextjs', 'react-query'],
    kind: 'skill',
    sourceId: 'web',
  },
  {
    name: 'custom-project-review',
    description: 'A team-authored review checklist that applies across projects.',
    tags: ['platform:general', 'review'],
    kind: 'skill',
    sourceId: 'custom',
  },
  {
    name: 'team-handbook',
    description: 'Notes awaiting a platform and technology classification.',
    tags: [],
    kind: 'skill',
    sourceId: 'custom',
  },
  {
    name: 'cloudflare-tools',
    description: 'Connect an agent to development and deployment tools.',
    tags: ['cloudflare', 'deployment'],
    kind: 'mcp',
    sourceId: 'backend',
  },
  {
    name: 'mobile-debug-tools',
    description: 'Expose project debugging tools to your agent.',
    tags: ['react-native', 'debugging'],
    kind: 'mcp',
    sourceId: 'mobile',
  },
  {
    name: 'ios-workflow-plugin',
    description: 'An installation recipe for an Apple development plugin.',
    tags: ['ios', 'workflow'],
    kind: 'plugin',
    sourceId: 'apple',
  },
  {
    name: 'api-design-notes',
    description: 'A saved reference for predictable API contracts.',
    tags: ['hono', 'api'],
    kind: 'resource',
    sourceId: 'backend',
  },
];
const names = {
  mobile: 'Mobile toolkit',
  apple: 'Apple engineering',
  backend: 'Backend collection',
  web: 'Web patterns',
  custom: 'Custom content',
};
const entries = rows.map((row, index) => ({
  ...row,
  id: `example-${index}`,
  digest: index.toString(16).padStart(64, '0'),
  custom: row.sourceId === 'custom',
  findings: [],
  updatedAt: `2026-11-${String(index + 1).padStart(2, '0')}T12:00:00Z`,
}));
const state: AppState = {
  entries,
  sources: Object.entries(names).map(([id, name]) => ({
    id,
    name,
    type: 'resource',
    url: `https://example.com/${id}`,
    recipe: '',
    status: 'unchecked',
    notes: 'Fictional design-preview collection.',
  })),
  projects: [
    {
      id: 'example-project',
      name: 'Fieldnotes',
      path: '/projects/fieldnotes',
      stacks: ['expo'],
      dependencies: [],
      providers: ['codex'],
      documents: [],
      detectedAt: '2026-11-05',
      requirements: '',
    },
  ],
  installations: [
    {
      entryId: 'example-0',
      projectId: 'example-project',
      provider: 'codex',
      path: '/projects/fieldnotes/.agents/skills/example',
      scope: 'project',
      lastSeen: '2026-11-05',
    },
  ],
  presets: [],
  rules: [],
  settings: {
    roots: [],
    scanGlobals: false,
    defaultProviders: ['codex'],
    aiRunner: 'none',
    ollamaModel: '',
    aiModel: '',
    discoveryDays: 0,
    discoveryQueries: [],
  },
  adapters: [
    {
      id: 'codex',
      name: 'Codex',
      skills: '.agents/skills',
      instructions: 'AGENTS.md',
      mcpFile: '.codex/config.toml',
      mcpKey: 'mcp_servers',
      format: 'toml',
      note: 'Fictional preview.',
      docs: 'https://example.com/codex',
    },
    {
      id: 'claude',
      name: 'Claude Code',
      skills: '.claude/skills',
      instructions: 'CLAUDE.md',
      mcpFile: '.mcp.json',
      mcpKey: 'mcpServers',
      format: 'json',
      note: 'Fictional preview.',
      docs: 'https://example.com/claude',
    },
  ],
  events: [],
  dataDirectory: '/example/private-library',
  scan: { state: 'idle', message: '', scanned: 0 },
  plans: [],
};
// This preview never forwards requests to a workbench, including one on the same origin.
const previewFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const request = input instanceof Request ? input : undefined;
  const path = new URL(request?.url || String(input), location.href).pathname;
  const method = init?.method || request?.method || 'GET';
  const found = method === 'GET' && path.match(/^\/api\/entries\/([A-Za-z0-9-]+)$/);
  const entry = found && entries.find((item) => item.id === found[1]);
  return entry
    ? Response.json({
        entry: { ...entry, body: '# Example skill\n\nFictional preview content.' },
        files: [],
      })
    : Response.json(
        { error: 'This is a design preview. No project or library changes are applied.' },
        { status: 403 },
      );
};
window.fetch = Object.assign(previewFetch, { preconnect: () => {} });

function Preview() {
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const discard = (event: Event) => (event as CustomEvent<DiscardRequest>).detail.proceed();
    window.addEventListener('kitfold-discard', discard);
    return () => window.removeEventListener('kitfold-discard', discard);
  }, []);
  return (
    <div className="preview-surface">
      <div className="preview-bar">
        <strong>Library explorer</strong>
        <span>Interactive preview · fictional data</span>
      </div>
      <main>
        <Library
          state={state}
          refresh={async () => undefined}
          notify={setNotice}
          navigate={() => undefined}
        />
      </main>
      {notice && (
        <div className="preview-notice" role="status">
          {notice}
          <button type="button" onClick={() => setNotice('')}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<Preview />);
