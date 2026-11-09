import type { AiDraft } from '../src/core/ai-drafts';
import { Badge } from './components';
import { t } from './i18n';

export function AiDraftPreview({
  draft,
  entries = [],
}: {
  draft: AiDraft;
  entries?: { id: string; name: string }[];
}) {
  const name = 'name' in draft ? draft.name : '';
  const names = new Map(entries.map((entry) => [entry.id, entry.name]));
  const content =
    draft.kind === 'skill'
      ? draft.body
      : draft.kind === 'rule'
        ? draft.content
        : draft.kind === 'requirements' || draft.kind === 'text'
          ? draft.text
          : '';
  return (
    <div className="ai-draft-preview">
      <div className="ai-draft-title">
        <h3>{name || t('Prepared text')}</h3>
        <Badge>
          {draft.kind === 'skill'
            ? 'Skill'
            : draft.kind === 'mcp'
              ? 'MCP'
              : draft.kind === 'preset'
                ? 'Preset'
                : draft.kind === 'source'
                  ? t('Source')
                  : draft.kind === 'rule'
                    ? t('Directive')
                    : t('Text')}
        </Badge>
      </div>
      {'description' in draft && <p>{draft.description}</p>}
      {draft.kind === 'rule' && (
        <p className="field-help">
          {t('Applies to')}: {draft.scope}
        </p>
      )}
      {content && <pre className="ai-readable-content">{content}</pre>}
      {draft.kind === 'source' && (
        <>
          <p className="field-label">{t('Source reference')}</p>
          <pre>{draft.input}</pre>
          {draft.recipe && draft.recipe !== draft.input && (
            <>
              <p className="field-label">{t('Installation recipe')}</p>
              <pre>{draft.recipe}</pre>
            </>
          )}
        </>
      )}
      {draft.kind === 'mcp' && (
        <>
          <p>{draft.mcp.transport === 'stdio' ? t('Command') : t('Endpoint')}</p>
          <pre>
            {draft.mcp.transport === 'stdio'
              ? [draft.mcp.command, ...draft.mcp.args].join(' ')
              : draft.mcp.url}
          </pre>
          <p className="field-help">{t('Definition only. No MCP server is started.')}</p>
        </>
      )}
      {'tags' in draft && (
        <div className="button-row">
          {draft.tags.map((tag) => (
            <Badge key={tag}>{tag}</Badge>
          ))}
        </div>
      )}
      {draft.kind === 'preset' && (
        <>
          <p className="field-help">
            {t('Stacks')}: {draft.stacks.join(' · ')}
          </p>
          <p className="field-help">Agents: {draft.providers.join(' · ')}</p>
          <p className="field-help">
            {t('Selectors')}: {draft.selectors.join(' · ')}
          </p>
        </>
      )}
      {'entryIds' in draft && draft.entryIds.length > 0 && (
        <div>
          <p className="field-label">{t('Suggested library items')}</p>
          <ul>
            {draft.entryIds.map((id) => (
              <li key={id}>{names.get(id) || t('Unavailable Snapshot')}</li>
            ))}
          </ul>
        </div>
      )}
      <details className="ai-structured-fields">
        <summary>{t('Show structured fields')}</summary>
        <pre>{JSON.stringify(draft, null, 2)}</pre>
      </details>
    </div>
  );
}
