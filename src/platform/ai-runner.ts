import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { AiRequest } from '../core/ai-drafts';
import { readReviewResponse } from '../core/review-response';

export const AI_TIMEOUT_MS = 120000;
const MAX_OUTPUT_BYTES = 1024 * 1024;
export type AiDriver = (input: {
  request: AiRequest;
  prompt: string;
  directory: string;
  signal: AbortSignal;
}) => Promise<string | unknown>;

export function aiProviders() {
  return [
    { id: 'claude', name: 'Claude Code', available: Boolean(Bun.which('claude')) },
    { id: 'codex', name: 'Codex', available: Boolean(Bun.which('codex')) },
    { id: 'ollama', name: 'Ollama', available: true },
    { id: 'session', name: 'Current agent · MCP', available: true },
  ];
}
function runnerEnvironment(runner: string): Record<string, string> {
  const allowed = [
    'PATH',
    'HOME',
    'USER',
    'TMPDIR',
    'LANG',
    'LC_ALL',
    'SYSTEMROOT',
    'USERPROFILE',
    'LOCALAPPDATA',
    'APPDATA',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'ALL_PROXY',
    'NO_PROXY',
    'SSL_CERT_FILE',
    'NODE_EXTRA_CA_CERTS',
  ];
  allowed.push(
    ...(runner === 'claude'
      ? ['CLAUDE_CONFIG_DIR', 'ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN']
      : ['CODEX_HOME', 'OPENAI_API_KEY']),
  );
  return Object.fromEntries(
    allowed.flatMap((name) => (process.env[name] ? [[name, process.env[name]!]] : [])),
  );
}
async function boundedStream(
  stream: ReadableStream<Uint8Array>,
  stop: () => void,
): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > MAX_OUTPUT_BYTES) {
        stop();
        throw new Error('AI process output exceeded its limit.');
      }
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks).toString('utf8');
}
export function aiCommand(runner: 'claude' | 'codex', model: string, output: string): string[] {
  if (runner === 'claude')
    return [
      'claude',
      '--print',
      '--safe-mode',
      '--restricted',
      '--tools',
      '',
      '--strict-mcp-config',
      '--mcp-config',
      '{"mcpServers":{}}',
      '--no-session-persistence',
      '--output-format',
      'json',
      ...(model ? ['--model', model] : []),
    ];
  return [
    'codex',
    'exec',
    '--ignore-user-config',
    '--ignore-rules',
    '--ephemeral',
    '--skip-git-repo-check',
    '--sandbox',
    'read-only',
    '--color',
    'never',
    '--json',
    ...[
      'shell_tool',
      'apps',
      'plugins',
      'hooks',
      'shell_snapshot',
      'view_image',
      'image_generation',
      'browser_use',
      'computer_use',
    ].flatMap((feature) => ['--disable', feature]),
    '-c',
    'agents.enabled=false',
    '-c',
    'web_search="disabled"',
    '-c',
    'mcp_servers={}',
    '-c',
    'project_doc_max_bytes=0',
    '-c',
    'skills.include_instructions=false',
    '-c',
    'skills.bundled.enabled=false',
    ...(model ? ['--model', model] : []),
    '--output-last-message',
    output,
    '-',
  ];
}
async function runProcess(
  command: string[],
  cwd: string,
  prompt: string,
  signal: AbortSignal,
): Promise<string> {
  signal.throwIfAborted();
  const executable = Bun.which(command[0]!, { PATH: process.env.PATH });
  if (!executable)
    throw new Error('The selected AI CLI is not installed. Choose another Provider.');
  const child = Bun.spawn([executable, ...command.slice(1)], {
    cwd,
    env: runnerEnvironment(command[0]!),
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
    detached: process.platform !== 'win32',
  });
  const stop = () => {
    if (child.exitCode !== null) return;
    try {
      if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
      else child.kill('SIGKILL');
    } catch {
      try {
        child.kill('SIGKILL');
      } catch {
        /* Already exited. */
      }
    }
  };
  signal.addEventListener('abort', stop, { once: true });
  if (signal.aborted) stop();
  try {
    child.stdin.write(prompt);
    child.stdin.end();
    const [stdout, , code] = await Promise.all([
      boundedStream(child.stdout, stop),
      boundedStream(child.stderr, stop),
      child.exited,
    ]);
    if (signal.aborted)
      throw new Error('AI generation was canceled or timed out. Your draft is unchanged.');
    if (code !== 0)
      throw new Error(
        'AI CLI could not finish. Check its login, installed version and model, or choose another Provider.',
      );
    return stdout;
  } finally {
    signal.removeEventListener('abort', stop);
    stop();
    await child.exited;
  }
}
export const runAi: AiDriver = async ({ request, prompt, directory, signal }) => {
  signal.throwIfAborted();
  if (request.runner === 'session')
    throw new Error('This request is waiting for your connected agent.');
  if (request.runner === 'ollama') {
    if (!request.model) throw new Error('Choose an installed Ollama model.');
    const response = await fetch('http://127.0.0.1:11434/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: request.model,
        prompt,
        stream: false,
        format: 'json',
        options: { num_predict: 6000 },
      }),
      signal,
    });
    if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}.`);
    return readReviewResponse(response);
  }
  await mkdir(join(directory, 'ai-work'), { recursive: true, mode: 0o700 });
  const scratch = await mkdtemp(join(directory, 'ai-work', 'draft-'));
  try {
    const output = join(scratch, 'result.json');
    const result = await runProcess(
      aiCommand(request.runner, request.model, output),
      scratch,
      prompt,
      signal,
    );
    if (request.runner === 'codex') {
      const file = Bun.file(output);
      if (!(await file.exists()) || file.size > MAX_OUTPUT_BYTES)
        throw new Error('Codex did not return a bounded final draft.');
      return file.text();
    }
    const envelope: unknown = JSON.parse(result);
    if (
      !envelope ||
      typeof envelope !== 'object' ||
      !('result' in envelope) ||
      typeof envelope.result !== 'string'
    )
      throw new Error('Claude Code did not return a final draft.');
    return envelope.result;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
};
