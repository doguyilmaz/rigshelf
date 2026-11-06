import type { Plan } from './model';
import { redact } from './safety';

export interface ChangeView {
  index: number;
  path: string;
  reason: string;
  operation: 'create' | 'modify' | 'remove';
  beforeBytes: number;
  afterBytes: number;
}
export interface PlanView {
  id: string;
  projectPath: string;
  providers: Plan['providers'];
  entries: string[];
  createdAt: string;
  warnings: string[];
  status: Plan['status'];
  purpose?: Plan['purpose'];
  requiresAdoption?: boolean;
  changes: ChangeView[];
  fileCount: number;
}
export interface FilePreview {
  before: string;
  after: string;
  redacted: boolean;
  truncated: boolean;
  binary: boolean;
}
export function planChanges(plan: Plan, offset: number, limit: number): ChangeView[] {
  return plan.changes.slice(offset, offset + limit).map((change, position) => ({
    index: offset + position,
    path: change.path,
    reason: change.reason,
    operation: change.after === null ? 'remove' : change.before === null ? 'create' : 'modify',
    beforeBytes: change.before === null ? 0 : Buffer.byteLength(change.before, 'base64'),
    afterBytes: change.after === null ? 0 : Buffer.byteLength(change.after, 'base64'),
  }));
}
export function planView(plan: Plan, limit = plan.changes.length): PlanView {
  return {
    id: plan.id,
    projectPath: plan.projectPath,
    providers: plan.providers,
    entries: plan.entries,
    createdAt: plan.createdAt,
    warnings: plan.warnings,
    status: plan.status,
    purpose: plan.purpose,
    requiresAdoption: plan.requiresAdoption,
    fileCount: plan.changes.length,
    changes: planChanges(plan, 0, limit),
  };
}
export function filePreview(plan: Plan, index: number): FilePreview {
  const change = plan.changes[index];
  if (!change) throw new Error('Plan file not found');
  let redacted = false,
    truncated = false,
    binary = false;
  function text(encoded: string | null, missing: string): string {
    if (encoded === null) return missing;
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.includes(0)) {
      binary = true;
      return `Binary resource · ${bytes.length} bytes`;
    }
    const decoded = bytes.toString('utf8');
    const safe = redact(decoded);
    redacted ||= safe !== decoded;
    truncated ||= safe.length > 25000;
    return safe.slice(0, 25000);
  }
  return {
    before: text(change.before, 'This file does not exist yet.'),
    after: text(change.after, 'This managed file will be removed.'),
    redacted,
    truncated,
    binary,
  };
}
