export const draftModels = {
  claude: [
    { value: 'haiku', label: 'Haiku · quick drafts' },
    { value: 'sonnet', label: 'Sonnet · more involved drafts' },
  ],
  codex: [
    { value: 'gpt-6-luna', label: 'GPT-6 Luna · quick drafts' },
    { value: 'gpt-6.1-terra', label: 'GPT-6.1 Terra · more involved drafts' },
  ],
} as const;

export function defaultDraftModel(runner: string): string {
  return runner === 'claude'
    ? draftModels.claude[0].value
    : runner === 'codex'
      ? draftModels.codex[0].value
      : '';
}
