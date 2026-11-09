import {
  type ScanDiagnostic,
  type ScanDiagnosticCategory,
  scanDiagnostics,
} from '../src/core/scan-diagnostics';
import { shortPath } from './api';
import { t } from './i18n';

const groups: { category: ScanDiagnosticCategory; title: string; description: string }[] = [
  {
    category: 'incomplete',
    title: 'Incomplete discovery',
    description: 'Some locations were not inspected. Previously indexed items were retained.',
  },
  {
    category: 'unreadable',
    title: 'Could not inspect',
    description:
      'Check the affected location and scan again. Earlier observations remain in the library.',
  },
  {
    category: 'empty',
    title: 'Empty MCP configurations',
    description:
      'These files are empty. No MCP definitions were read; earlier observations were retained.',
  },
  {
    category: 'excluded',
    title: 'Intentional exclusions',
    description:
      'These locations were excluded by discovery rules. Their source files were left untouched.',
  },
];
const labels: Record<ScanDiagnostic['code'], string> = {
  'plugin-limit': 'Plugin discovery reached a traversal limit.',
  'project-limit': 'Project discovery reached a directory, depth or AI-location limit.',
  limit: 'Discovery did not cover every location in this scope.',
  'mcp-empty': 'Empty MCP configuration',
  'mcp-syntax': 'MCP configuration has invalid syntax.',
  unreadable: 'This location could not be inspected.',
  excluded: 'Excluded by discovery rules',
};
export function ScanDiagnostics({ messages }: { messages: string[] }) {
  const diagnostics = scanDiagnostics(messages);
  if (!diagnostics.length) return null;
  const attention = diagnostics.filter(
    (item) => item.category === 'incomplete' || item.category === 'unreadable',
  ).length;
  return (
    <details className="scan-diagnostics">
      <summary>
        {attention
          ? t(
              attention === 1
                ? '{{count}} scan issue needs attention'
                : '{{count}} scan issues need attention',
              { count: attention },
            )
          : t('Scan notes ({{count}})', { count: diagnostics.length })}
      </summary>
      <p className="scan-diagnostics-intro">
        {t(
          'Scan results describe coverage, not lost files. Source projects and agent settings are never edited by scanning.',
        )}
      </p>
      {groups.map((group) => {
        const items = diagnostics.filter((item) => item.category === group.category);
        if (!items.length) return null;
        return (
          <section
            key={group.category}
            className="scan-diagnostic-group"
            aria-label={t(group.title)}
          >
            <h3>
              {t(group.title)} <span>{items.length}</span>
            </h3>
            <p>{t(group.description)}</p>
            <ul>
              {items.map((item) => (
                <li key={`${item.path}:${item.detail}`}>
                  {item.path && <code>{shortPath(item.path)}</code>}
                  <span>{t(labels[item.code])}</span>
                  {item.line !== undefined && (
                    <span>
                      {t('Line {{line}}, column {{column}}', {
                        line: item.line,
                        column: item.column || 1,
                      })}
                    </span>
                  )}
                  <details>
                    <summary>{t('Technical details')}</summary>
                    <p>{item.detail}</p>
                  </details>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </details>
  );
}
