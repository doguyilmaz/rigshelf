import { lazy, type ReactNode, Suspense, useEffect, useState } from 'react';
import { Spinner } from '../components';
import { t } from '../i18n';
import { ModalPresence } from '../ModalPresence';
import { type SetupProps, useProjectSetup } from '../useProjectSetup';
import { EntryDetail } from './EntryDetail';
import { PlanReview } from './PlanReview';
import { ProjectLaunchpad } from './ProjectLaunchpad';
import { ProjectWorkspace } from './ProjectWorkspace';

const SetupKitPicker = lazy(() =>
  import('./SetupKitPicker').then((module) => ({ default: module.SetupKitPicker })),
);
const AcquireTools = lazy(() =>
  import('./AcquireTools').then((module) => ({ default: module.AcquireTools })),
);
export function Setup(props: SetupProps): ReactNode {
  const { state, navigate, active = true } = props;
  const setup = useProjectSetup(props);
  const [picker, setPicker] = useState<'all' | 'skill' | 'mcp'>();
  const [inspecting, setInspecting] = useState<string>();
  const [acquiring, setAcquiring] = useState(false);
  useEffect(() => {
    if (!active) {
      setPicker(undefined);
      setInspecting(undefined);
      setAcquiring(false);
    }
  }, [active]);
  return (
    <>
      {setup.detected ? (
        <ProjectWorkspace
          {...props}
          setup={setup}
          active={active}
          add={(kind) => setPicker(kind || 'all')}
          inspect={setInspecting}
        />
      ) : (
        <ProjectLaunchpad {...props} setup={setup} active={active} />
      )}
      <ModalPresence>
        {active && picker && !acquiring && (
          <Suspense fallback={<Spinner text={t('Loading page…')} />}>
            <SetupKitPicker
              state={state}
              initialKind={picker}
              selected={setup.selected}
              toggle={setup.toggleEntry}
              inspect={setInspecting}
              onClose={() => setPicker(undefined)}
              acquire={() => setAcquiring(true)}
              openLibrary={() => {
                setPicker(undefined);
                navigate('library');
              }}
            />
          </Suspense>
        )}
      </ModalPresence>
      <ModalPresence>
        {active && acquiring && (
          <Suspense fallback={<Spinner text={t('Loading page…')} />}>
            <AcquireTools
              {...props}
              stacks={setup.detected?.project.stacks || []}
              onAdd={setup.addEntry}
              onClose={() => setAcquiring(false)}
            />
          </Suspense>
        )}
      </ModalPresence>
      <ModalPresence>
        {active && inspecting && (
          <EntryDetail {...props} id={inspecting} onClose={() => setInspecting(undefined)} />
        )}
      </ModalPresence>
      <ModalPresence>
        {active && setup.plan && (
          <PlanReview
            plan={setup.plan}
            onClose={() => setup.setPlan(undefined)}
            onApplied={setup.applied}
            notify={props.notify}
            state={state}
            navigate={navigate}
          />
        )}
      </ModalPresence>
    </>
  );
}
