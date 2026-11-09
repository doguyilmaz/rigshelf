import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';

const MAX_PATH_LENGTH = 8192;
const MAX_OUTPUT_BYTES = 16 * 1024;
const PICKER_TIMEOUT_MS = 3 * 60 * 1000;
const MAX_PARENT_LOOKUPS = 64;
const PathSchema = z
  .string()
  .max(MAX_PATH_LENGTH)
  .regex(/^[^\0\r\n]*$/);
const RequestSchema = z.object({ initialPath: PathSchema.default('') }).strict();
const executeFile = promisify(execFile);

const APPLE_SCRIPT = `on run argv
  try
    set selection to choose folder with prompt "Choose a folder for Rigshelf" default location (POSIX file (item 1 of argv))
    return POSIX path of selection
  on error number -128
    return ""
  end try
end run`;

const WINDOWS_SCRIPT = `Add-Type -AssemblyName System.Windows.Forms
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Choose a folder for Rigshelf'
$dialog.SelectedPath = $env:RIGSHELF_PICKER_START
$dialog.ShowNewFolderButton = $false
try {
  if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    [Console]::WriteLine($dialog.SelectedPath)
  }
} finally { $dialog.Dispose() }`;

export type DirectoryPickerDriver = (
  initialPath: string,
  signal: AbortSignal,
) => Promise<string | null>;
interface PickerCommand {
  executable: string;
  args: string[];
  cancelExitCode?: number;
}

/** Only fixed OS-dialog programs run. A path is an argument/environment value, never script source. */
export function directoryPickerCommand(
  platform: NodeJS.Platform,
  initialPath: string,
  which: (name: string) => string | null = Bun.which,
): PickerCommand {
  if (platform === 'darwin')
    return { executable: '/usr/bin/osascript', args: ['-e', APPLE_SCRIPT, '--', initialPath] };
  if (platform === 'win32') {
    const executable = which('powershell.exe');
    if (executable)
      return {
        executable,
        args: ['-NoProfile', '-NonInteractive', '-STA', '-Command', WINDOWS_SCRIPT],
      };
  }
  if (platform === 'linux') return linuxDirectoryCommand(initialPath, which);
  throw new Error(
    'Native folder selection is unavailable on this system. Enter the path manually.',
  );
}

function linuxDirectoryCommand(
  initialPath: string,
  which: (name: string) => string | null,
): PickerCommand {
  const zenity = which('zenity');
  if (zenity)
    return {
      executable: zenity,
      args: [
        '--file-selection',
        '--directory',
        '--title=Choose a folder for Rigshelf',
        `--filename=${initialPath}${initialPath.endsWith(sep) ? '' : sep}`,
      ],
      cancelExitCode: 1,
    };
  const kdialog = which('kdialog');
  if (kdialog)
    return {
      executable: kdialog,
      args: ['--getexistingdirectory', initialPath, '--title', 'Choose a folder for Rigshelf'],
      cancelExitCode: 1,
    };
  throw new Error(
    'Native folder selection is unavailable on this system. Enter the path manually.',
  );
}

function pickerEnvironment(initialPath: string): NodeJS.ProcessEnv {
  const names = [
    'HOME',
    'USER',
    'LOGNAME',
    'PATH',
    'TMPDIR',
    'DISPLAY',
    'WAYLAND_DISPLAY',
    'XDG_RUNTIME_DIR',
    'DBUS_SESSION_BUS_ADDRESS',
    'LANG',
    'LC_ALL',
    'SystemRoot',
    'WINDIR',
    'USERPROFILE',
    'TEMP',
    'TMP',
    'APPDATA',
    'LOCALAPPDATA',
  ];
  const environment: NodeJS.ProcessEnv = { RIGSHELF_PICKER_START: initialPath };
  for (const name of names) if (process.env[name]) environment[name] = process.env[name];
  return environment;
}

async function nativeDirectory(initialPath: string, signal: AbortSignal): Promise<string | null> {
  const command = directoryPickerCommand(process.platform, initialPath);
  try {
    const { stdout } = await executeFile(command.executable, command.args, {
      encoding: 'utf8',
      env: pickerEnvironment(initialPath),
      signal,
      timeout: PICKER_TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_BYTES,
      windowsHide: true,
    });
    // Remove only the process line ending, preserving spaces in legitimate folder names.
    return stdout.replace(/\r?\n$/, '') || null;
  } catch (error) {
    if (signal.aborted) throw new Error('Folder selection was canceled.');
    if (
      error instanceof Error &&
      command.cancelExitCode !== undefined &&
      'code' in error &&
      error.code === command.cancelExitCode &&
      'stderr' in error &&
      !String(error.stderr).trim()
    )
      return null;
    throw new Error('Could not open the folder picker. Enter the path manually.');
  }
}

async function startingDirectory(path: string, signal: AbortSignal): Promise<string> {
  let candidate =
    path === '~'
      ? homedir()
      : path.startsWith('~/')
        ? resolve(homedir(), path.slice(2))
        : resolve(path || homedir());
  for (let attempt = 0; attempt < MAX_PARENT_LOOKUPS; attempt++) {
    signal.throwIfAborted();
    try {
      if ((await stat(candidate)).isDirectory()) return candidate;
    } catch {
      /* Try its parent. */
    }
    const parent = dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  return homedir();
}

async function selectDirectory(
  initialPath: string,
  signal: AbortSignal,
  driver: DirectoryPickerDriver,
) {
  const initial = await startingDirectory(initialPath, signal);
  signal.throwIfAborted();
  const selected = await driver(initial, signal);
  signal.throwIfAborted();
  if (selected === null) return { path: null };
  if (!PathSchema.safeParse(selected).success || !isAbsolute(selected))
    throw new Error('The folder picker returned an invalid path. Enter the path manually.');
  let directory = false;
  try {
    directory = (await stat(selected)).isDirectory();
  } catch {
    /* Report without private OS details. */
  }
  if (!directory)
    throw new Error('The selected folder is no longer available. Choose another folder.');
  return { path: resolve(selected) };
}

/** A server owns one dialog; shutting it down aborts and drains its pending selection. */
export function createDirectoryPicker(driver: DirectoryPickerDriver = nativeDirectory) {
  let active: AbortController | undefined;
  let pending: Promise<{ path: string | null }> | undefined;
  let closed = false;
  return {
    pick(input: unknown, signal?: AbortSignal): Promise<{ path: string | null }> {
      const request = RequestSchema.safeParse(input);
      if (!request.success) throw new Error('Enter a valid folder path before browsing.');
      if (closed) throw new Error('The folder picker has closed.');
      if (active) throw new Error('A folder picker is already open. Finish that selection first.');
      const controller = new AbortController();
      active = controller;
      const combined = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
      pending = selectDirectory(request.data.initialPath, combined, driver).finally(() => {
        active = undefined;
        pending = undefined;
      });
      return pending;
    },
    async close(): Promise<void> {
      closed = true;
      const settling = pending;
      active?.abort();
      await settling?.catch(() => undefined);
    },
  };
}
