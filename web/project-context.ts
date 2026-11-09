/** A current form choice, never evidence of project ownership or permission. */
export interface CurrentProject {
  id: string;
  name: string;
  path: string;
  entryIds: string[];
}

/** One explicit Library selection, bound to the kit visible when it was requested. */
export interface KitEntryRequest {
  sequence: number;
  projectId: string;
  entryId: string;
}
