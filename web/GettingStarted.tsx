import { ArrowRight } from 'lucide-react';
import { useState } from 'react';
import { Button, Modal, Notice } from './components';
import { t } from './i18n';
import type { Page } from './main';

const ONBOARDING_KEY = 'rigshelf:onboarding:v1';
export function rememberOnboarding(): void {
  try {
    localStorage.setItem(ONBOARDING_KEY, 'seen');
  } catch {
    /* Optional browser preference. */
  }
}

const steps = [
  {
    title: 'Discover your existing tools',
    text: 'Open Library and scan your configured project folders. Known AI files are inspected even when gitignored. Scanning imports Skills and MCP definitions into the private library; it never activates them or edits their originals.',
    action: 'Open Library',
    page: 'library',
  },
  {
    title: 'Choose a focused project kit',
    text: 'Choose a known project or use Browse to inspect its folder automatically. For a typed path, choose Build my kit. Review the suggested kit, add what you need from Library and check the selected Agents. Requirements and presets are optional; no project files are written during inspection.',
    action: 'Set up my project',
    page: 'setup',
  },
  {
    title: 'Inspect the files before applying',
    text: 'Review setup creates a plan without writing project files. Open the file changes, read compatibility notes and resolve conflicts. Existing authored guidance stays protected. Apply is a separate action after this review.',
    action: 'Set up my project',
    page: 'setup',
  },
  {
    title: 'Verify, update and recover',
    text: 'After applying, open your agent session and verify the kit. Keep dependency automation off until you approve both the project and exact snapshots. Activity keeps setup plans and rollback actions. Settings lets you download previous inventory checkpoints; those do not grant setup permission.',
    action: 'Open Activity',
    page: 'activity',
  },
] as const;

export function GettingStarted({
  initialMode,
  onClose,
  onNavigate,
}: {
  initialMode: 'guide' | 'example';
  onClose: () => void;
  onNavigate: (page: Page) => void;
}) {
  const [mode, setMode] = useState(initialMode);
  const [step, setStep] = useState(0);
  const current = steps[step]!;
  return (
    <Modal
      title={t('Getting started')}
      subtitle={t('Learn the workflow at your own pace. You can reopen this guide any time.')}
      onClose={onClose}
      wide
    >
      <fieldset className="learning-mode">
        <legend>{t('Learning mode')}</legend>
        <div className="tabs compact">
          <button
            type="button"
            className={mode === 'guide' ? 'active' : ''}
            aria-pressed={mode === 'guide'}
            onClick={() => setMode('guide')}
          >
            {t('Workflow guide')}
          </button>
          <button
            type="button"
            className={mode === 'example' ? 'active' : ''}
            aria-pressed={mode === 'example'}
            onClick={() => setMode('example')}
          >
            {t('Practice with an example')}
          </button>
        </div>
      </fieldset>
      <div className="onboarding-body">
        {mode === 'guide' ? (
          <>
            <ol className="onboarding-steps" aria-label={t('Setup workflow')}>
              {steps.map((item, index) => (
                <li key={item.title}>
                  <button
                    type="button"
                    aria-current={index === step ? 'step' : undefined}
                    onClick={() => setStep(index)}
                  >
                    <span>{index + 1}</span>
                    {t(item.title)}
                  </button>
                </li>
              ))}
            </ol>
            <section className="onboarding-panel">
              <p className="eyebrow">
                {t('Step {{current}} of {{total}}', { current: step + 1, total: steps.length })}
              </p>
              <h2>{t(current.title)}</h2>
              <p>{t(current.text)}</p>
              <Notice>
                {t(
                  'Stored in Library does not mean active in a project or loaded into an agent session.',
                )}
              </Notice>
              <div className="button-row">
                <Button
                  variant="secondary"
                  disabled={step === 0}
                  onClick={() => setStep((value) => value - 1)}
                >
                  {t('Previous')}
                </Button>
                {step < steps.length - 1 ? (
                  <Button onClick={() => setStep((value) => value + 1)}>{t('Next')}</Button>
                ) : (
                  <Button onClick={() => setMode('example')}>{t('Try an example')}</Button>
                )}
                <Button variant="ghost" onClick={() => onNavigate(current.page)}>
                  {t(current.action)}
                  <ArrowRight size={14} />
                </Button>
              </div>
            </section>
          </>
        ) : (
          <Practice onNavigate={onNavigate} />
        )}
      </div>
    </Modal>
  );
}

function Practice({ onNavigate }: { onNavigate: (page: Page) => void }) {
  const [phase, setPhase] = useState<'choose' | 'review' | 'applied' | 'rolled-back'>('choose');
  const [agents, setAgents] = useState(['claude', 'codex']);
  const [skill, setSkill] = useState(true);
  const [mcp, setMcp] = useState(false);
  const paths = [
    'AGENTS.md',
    ...(agents.includes('claude') ? ['CLAUDE.md'] : []),
    ...(skill
      ? agents.map(
          (agent) => `${agent === 'claude' ? '.claude' : '.agents'}/skills/example-guide/SKILL.md`,
        )
      : []),
    ...(mcp
      ? agents.map((agent) => (agent === 'claude' ? '.mcp.json' : '.codex/config.toml'))
      : []),
  ];
  return (
    <section className="onboarding-practice" aria-label={t('Example project simulation')}>
      <Notice>
        {t(
          'Simulation only. This example makes no API requests, writes no files and does not change your library.',
        )}
      </Notice>
      <h2>{t('Example Expo app')}</h2>
      {phase === 'choose' ? (
        <>
          <p>{t('Choose what the example kit contains, then review its file paths.')}</p>
          <fieldset>
            <legend>{t('Example agents')}</legend>
            <div className="button-row">
              {['claude', 'codex'].map((agent) => (
                <label className="check-label" key={agent}>
                  <input
                    type="checkbox"
                    checked={agents.includes(agent)}
                    onChange={() =>
                      setAgents((current) =>
                        current.includes(agent)
                          ? current.filter((value) => value !== agent)
                          : [...current, agent],
                      )
                    }
                  />
                  {agent === 'claude' ? 'Claude Code' : 'Codex'}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="check-label">
            <input
              type="checkbox"
              checked={skill}
              onChange={(event) => setSkill(event.target.checked)}
            />
            {t('Include example Skill')}
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={mcp}
              onChange={(event) => setMcp(event.target.checked)}
            />
            {t('Include example MCP server')}
          </label>
          <Button disabled={!agents.length} onClick={() => setPhase('review')}>
            {t('Review example plan')}
          </Button>
        </>
      ) : (
        <>
          <p role="status">
            {t(
              phase === 'review'
                ? 'The example plan is ready. A real plan would still require a separate Apply action.'
                : phase === 'applied'
                  ? 'Example applied. Your real projects and library remain untouched.'
                  : 'Example rollback complete. Your real projects and library remain untouched.',
            )}
          </p>
          <ul className="onboarding-files" aria-label={t('Example file changes')}>
            {paths.map((path) => (
              <li key={path}>
                <code>{path}</code>
              </li>
            ))}
          </ul>
          <div className="button-row">
            {phase === 'review' && (
              <Button onClick={() => setPhase('applied')}>{t('Simulate Apply')}</Button>
            )}
            {phase === 'applied' && (
              <Button variant="secondary" onClick={() => setPhase('rolled-back')}>
                {t('Simulate rollback')}
              </Button>
            )}
            <Button variant="secondary" onClick={() => setPhase('choose')}>
              {t('Reset example')}
            </Button>
            <Button variant="ghost" onClick={() => onNavigate('setup')}>
              {t('Set up my project')}
              <ArrowRight size={14} />
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
