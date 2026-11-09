import { expect, test } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { createDirectoryPicker, directoryPickerCommand } from '../src/platform/folder-picker';
import { fixture } from './helpers';

test('folder dialog commands keep Unicode, quotes and shell syntax out of executable script source', () => {
  const path = '/fictional/日本語 $(touch should-not-exist); "quoted"';
  const mac = directoryPickerCommand('darwin', path);
  expect(mac.executable).toBe('/usr/bin/osascript');
  expect(mac.args.at(-1)).toBe(path);
  expect(mac.args[1]).not.toContain(path);
  const windows = directoryPickerCommand('win32', path, () => '/trusted/powershell.exe');
  expect(windows.args.at(-1)).not.toContain(path);
  expect(windows.args.at(-1)).toContain('$env:KITFOLD_PICKER_START');
  const linux = directoryPickerCommand('linux', path, (name) => `/trusted/${name}`);
  expect(linux.executable).toBe('/trusted/zenity');
  expect(linux.args).toContain(`--filename=${path}/`);
  expect(
    directoryPickerCommand('linux', path, (name) =>
      name === 'kdialog' ? '/trusted/kdialog' : null,
    ).args,
  ).toContain(path);
  expect(() => directoryPickerCommand('linux', path, () => null)).toThrow('unavailable');
});

test('folder selection starts at an existing ancestor, preserves spaces and never installs the selection', async () => {
  const data = await fixture();
  const selected = join(data.root, '日本語 folder with trailing space ');
  await mkdir(selected);
  const before = data.store.settings();
  let start = '';
  const picker = createDirectoryPicker(async (initial) => {
    start = initial;
    return selected + sep;
  });
  try {
    expect(await picker.pick({ initialPath: join(data.project, 'not-created', 'next') })).toEqual({
      path: selected,
    });
    expect(start).toBe(data.project);
    expect(data.store.settings()).toEqual(before);
    expect(data.store.projects()).toHaveLength(0);
    expect(data.store.entries()).toHaveLength(0);
  } finally {
    await picker.close();
    await data.cleanup();
  }
});

test('canceling returns no path and invalid requests or non-directory results do not become selections', async () => {
  const data = await fixture();
  let calls = 0;
  let selected: string | null = null;
  const picker = createDirectoryPicker(async () => {
    calls++;
    return selected;
  });
  try {
    expect(() => picker.pick({ initialPath: 'bad\0path' })).toThrow('valid folder path');
    expect(() => picker.pick({ initialPath: data.project, command: 'unexpected' })).toThrow(
      'valid folder path',
    );
    expect(calls).toBe(0);
    expect(await picker.pick({})).toEqual({ path: null });
    selected = join(data.root, 'file.txt');
    await Bun.write(selected, 'Fixture, not a folder.');
    await expect(picker.pick({})).rejects.toThrow('no longer available');
    selected = 'relative/folder';
    await expect(picker.pick({})).rejects.toThrow('invalid path');
    selected = `${data.project}\n`;
    await expect(picker.pick({})).rejects.toThrow('invalid path');
    selected = data.project;
    expect(await picker.pick({})).toEqual({ path: data.project });
  } finally {
    await picker.close();
    await data.cleanup();
  }
});

test('one pending dialog blocks duplicates and request cancellation releases its slot', async () => {
  const data = await fixture();
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const picker = createDirectoryPicker(
    (_initial, signal) =>
      new Promise((_resolve, reject) => {
        started();
        signal.addEventListener('abort', () => reject(new Error('Canceled by fixture')), {
          once: true,
        });
      }),
  );
  try {
    const controller = new AbortController();
    const pending = picker.pick({ initialPath: data.project }, controller.signal);
    const rejected = pending.catch((error: unknown) => error);
    await ready;
    expect(() => picker.pick({})).toThrow('already open');
    controller.abort();
    expect(await rejected).toEqual(new Error('Canceled by fixture'));
    const canceled = new AbortController();
    canceled.abort();
    await expect(picker.pick({}, canceled.signal)).rejects.toThrow();
  } finally {
    await picker.close();
    await data.cleanup();
  }
});

test('closing a picker aborts and drains the active dialog and refuses later requests', async () => {
  const data = await fixture();
  let started!: () => void;
  let stopped = false;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const picker = createDirectoryPicker(
    (_initial, signal) =>
      new Promise((_resolve, reject) => {
        started();
        signal.addEventListener(
          'abort',
          () => {
            stopped = true;
            reject(new Error('Stopped by fixture'));
          },
          { once: true },
        );
      }),
  );
  try {
    const pending = picker.pick({ initialPath: data.project });
    const rejected = pending.catch((error: unknown) => error);
    await ready;
    await picker.close();
    expect(await rejected).toEqual(new Error('Stopped by fixture'));
    expect(stopped).toBe(true);
    expect(() => picker.pick({})).toThrow('closed');
  } finally {
    await picker.close();
    await data.cleanup();
  }
});
