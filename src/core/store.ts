import { Database } from 'bun:sqlite';
import { chmodSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Entry, Installation, PackedFile, Plan, Project, Settings, Source } from './model';
import { SCHEMA_VERSION, SettingsSchema } from './model';
import { now } from './safety';

export class Store {
  readonly db: Database;
  readonly directory: string;
  constructor(
    directory = process.env.RIGSHELF_DATA_DIR ||
      process.env.KITFOLD_DATA_DIR ||
      join(homedir(), '.local/share/kitfold'),
  ) {
    this.directory = directory;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.db = new Database(join(directory, 'catalog.sqlite'), { create: true, strict: true });
    chmodSync(join(directory, 'catalog.sqlite'), 0o600);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
    const version = this.db.query('PRAGMA user_version').get() as { user_version: number };
    if (version.user_version > SCHEMA_VERSION)
      throw new Error('Catalog is newer than this application. Upgrade Rigshelf.');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS records (type TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(type,id));
      CREATE TABLE IF NOT EXISTS entries (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, source_id TEXT NOT NULL, data TEXT NOT NULL, body TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS entries_source ON entries(source_id);
      CREATE TABLE IF NOT EXISTS files (entry_id TEXT NOT NULL, path TEXT NOT NULL, content TEXT NOT NULL, executable INTEGER NOT NULL, PRIMARY KEY(entry_id,path));
      CREATE TABLE IF NOT EXISTS installations (path TEXT PRIMARY KEY, entry_id TEXT NOT NULL, project_id TEXT, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL);
      PRAGMA user_version=1;
    `);
  }
  close(): void {
    this.db.close();
  }
  get<T>(type: string, id: string): T | undefined {
    const row = this.db.query('SELECT data FROM records WHERE type=? AND id=?').get(type, id) as {
      data: string;
    } | null;
    return row ? (JSON.parse(row.data) as T) : undefined;
  }
  list<T>(type: string): T[] {
    return (
      this.db.query('SELECT data FROM records WHERE type=? ORDER BY id').all(type) as {
        data: string;
      }[]
    ).map((row) => JSON.parse(row.data) as T);
  }
  put<T extends { id: string }>(type: string, value: T): void {
    this.db
      .query(
        'INSERT INTO records(type,id,data) VALUES(?,?,?) ON CONFLICT(type,id) DO UPDATE SET data=excluded.data',
      )
      .run(type, value.id, JSON.stringify(value));
  }
  remove(type: string, id: string): void {
    this.db.query('DELETE FROM records WHERE type=? AND id=?').run(type, id);
  }
  entries(includeArchived = false): Omit<Entry, 'body'>[] {
    return (
      this.db.query('SELECT data FROM entries ORDER BY name COLLATE NOCASE').all() as {
        data: string;
      }[]
    )
      .map((row) => JSON.parse(row.data) as Omit<Entry, 'body'>)
      .filter((entry) => includeArchived || !entry.archived);
  }
  entry(id: string): Entry | undefined {
    const row = this.db.query('SELECT data,body FROM entries WHERE id=?').get(id) as {
      data: string;
      body: string;
    } | null;
    return row ? ({ ...JSON.parse(row.data), body: row.body } as Entry) : undefined;
  }
  saveEntry(entry: Entry, files: PackedFile[] = []): void {
    const { body, ...metadata } = entry;
    this.db.transaction(() => {
      this.db
        .query(
          'INSERT INTO entries(id,name,kind,source_id,data,body) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,kind=excluded.kind,source_id=excluded.source_id,data=excluded.data,body=excluded.body',
        )
        .run(entry.id, entry.name, entry.kind, entry.sourceId, JSON.stringify(metadata), body);
      if (files.length) {
        this.db.query('DELETE FROM files WHERE entry_id=?').run(entry.id);
        for (const file of files)
          this.db
            .query('INSERT INTO files VALUES(?,?,?,?)')
            .run(entry.id, file.path, file.content, Number(file.executable));
      }
    })();
  }
  files(id: string): PackedFile[] {
    return (
      this.db
        .query('SELECT path,content,executable FROM files WHERE entry_id=? ORDER BY path')
        .all(id) as { path: string; content: string; executable: number }[]
    ).map((row) => ({ ...row, executable: Boolean(row.executable) }));
  }
  fileMetadata(id: string): { path: string; bytes: number; executable: boolean }[] {
    return (
      this.db
        .query(
          "SELECT path, (length(content)*3/4) - CASE WHEN substr(content,-2)='==' THEN 2 WHEN substr(content,-1)='=' THEN 1 ELSE 0 END AS bytes, executable FROM files WHERE entry_id=? ORDER BY path",
        )
        .all(id) as { path: string; bytes: number; executable: number }[]
    ).map((row) => ({ ...row, executable: Boolean(row.executable) }));
  }
  fileAt(id: string, index: number): PackedFile | undefined {
    const row = this.db
      .query(
        'SELECT path,content,executable FROM files WHERE entry_id=? ORDER BY path LIMIT 1 OFFSET ?',
      )
      .get(id, index) as { path: string; content: string; executable: number } | null;
    return row ? { ...row, executable: Boolean(row.executable) } : undefined;
  }
  deleteEntry(id: string): void {
    this.db.transaction(() => {
      this.db.query('DELETE FROM files WHERE entry_id=?').run(id);
      this.db.query('DELETE FROM entries WHERE id=?').run(id);
      this.db.query('DELETE FROM installations WHERE entry_id=?').run(id);
    })();
  }
  installation(value: Installation): void {
    this.db
      .query(
        'INSERT INTO installations VALUES(?,?,?,?) ON CONFLICT(path) DO UPDATE SET entry_id=excluded.entry_id,project_id=excluded.project_id,data=excluded.data',
      )
      .run(value.path, value.entryId, value.projectId, JSON.stringify(value));
  }
  installations(): Installation[] {
    return (this.db.query('SELECT data FROM installations').all() as { data: string }[]).map(
      (row) => JSON.parse(row.data) as Installation,
    );
  }
  removeInstallation(path: string): void {
    this.db.query('DELETE FROM installations WHERE path=?').run(path);
  }
  event(action: string, detail: string): void {
    this.db
      .query('INSERT INTO events(created_at,action,detail) VALUES(?,?,?)')
      .run(now(), action, detail);
  }
  events(): { id: number; createdAt: string; action: string; detail: string }[] {
    return this.db
      .query(
        'SELECT id,created_at AS createdAt,action,detail FROM events ORDER BY id DESC LIMIT 100',
      )
      .all() as { id: number; createdAt: string; action: string; detail: string }[];
  }
  sources(): Source[] {
    return this.list<Source>('source');
  }
  projects(): Project[] {
    return this.list<Project>('project');
  }
  planReferences(id: string): boolean {
    return Boolean(
      this.db
        .query(
          "SELECT 1 FROM records, json_each(records.data,'$.entries') AS entry WHERE records.type='plan' AND json_extract(records.data,'$.status')!='rolled-back' AND entry.value=? LIMIT 1",
        )
        .get(id),
    );
  }
  planSummaries(): (Omit<Plan, 'changes'> & { fileCount: number })[] {
    const rows = this.db
      .query(
        "SELECT json_remove(data,'$.changes','$.ownershipBefore','$.ownershipAfter') AS data, json_array_length(data,'$.changes') AS count FROM records WHERE type='plan' ORDER BY json_extract(data,'$.createdAt') DESC LIMIT 100",
      )
      .all() as { data: string; count: number }[];
    return rows.map((row) => ({ ...JSON.parse(row.data), fileCount: row.count }));
  }
  settings(): Settings {
    return SettingsSchema.parse(
      this.get<Settings>('settings', 'main') || {
        roots: [join(homedir(), 'Developer')],
        scanGlobals: true,
        defaultProviders: ['claude', 'codex'],
        aiRunner: 'none',
        ollamaModel: '',
        discoveryDays: 0,
        discoveryQueries: [],
      },
    );
  }
}
