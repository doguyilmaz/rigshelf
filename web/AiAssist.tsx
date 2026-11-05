import { WandSparkles } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import type { AiAssistProps } from './AiAssistPanel';
import { Button, Spinner } from './components';
import { t } from './i18n';

const Panel = lazy(() =>
  import('./AiAssistPanel').then((module) => ({ default: module.AiAssistPanel })),
);
export function AiAssist(props: AiAssistProps) {
  const [open, setOpen] = useState(props.defaultOpen || false);
  if (!open)
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <WandSparkles size={15} />
        {props.label || t('Help me with AI')}
      </Button>
    );
  return (
    <Suspense fallback={<Spinner text={t('Loading AI assistance…')} />}>
      <Panel {...props} onClose={props.defaultOpen ? undefined : () => setOpen(false)} />
    </Suspense>
  );
}
