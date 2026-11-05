import type { Finding, Rule } from './model';
import { redact, scanText } from './safety';

export function guidanceFindings(rule: Rule): Finding[] {
  const findings = scanText(rule.content, `Directive: ${rule.id}`);
  if (
    redact(rule.content) !== rule.content &&
    !findings.some((finding) => finding.level === 'block')
  )
    findings.push({
      code: 'guidance-credential',
      level: 'block',
      message:
        'Credential-looking values must stay outside reusable guidance. Use environment references.',
    });
  return findings;
}
