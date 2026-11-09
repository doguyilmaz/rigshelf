import { lazy, type ReactNode, Suspense, useEffect, useRef, useState } from 'react';
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
  const project = setup.detected?.project;
  const projectId = project?.id;
  const projectName = state.projects.find((item) => item.id === projectId)?.name || project?.name;
  const projectPath = project?.path;
  const current = setup.path === setup.candidatePath.trim();
  const publishProject = props.onCurrentProjectChange;
  useEffect(() => {
    publishProject?.(
      projectId && projectName && projectPath && current
        ? { id: projectId, name: projectName, path: projectPath, entryIds: setup.selected }
        : undefined,
    );
  }, [projectId, projectName, projectPath, current, setup.selected, publishProject]);
  const consumedEntry = useRef(0);
  const chooseEntry = useRef(setup.addEntry);
  chooseEntry.current = setup.addEntry;
  const [picker, setPicker] = useState<'all' | 'skill' | 'mcp'>();
  const [inspecting, setInspecting] = useState<string>();
  const [acquiring, setAcquiring] = useState<string>();
  const scope = useRef({ path: setup.path, active, acquiring });
  scope.current = { path: setup.path, active, acquiring };
  useEffect(() => {
    const requested = props.entryRequest;
    if (!requested || requested.sequence === consumedEntry.current) return;
    consumedEntry.current = requested.sequence;
    const entry = state.entries.find((item) => item.id === requested.entryId);
    if (!current || projectId !== requested.projectId || !entry) {
      props.notify(
        t('The project or Snapshot changed. Inspect the current kit before adding this item.'),
        true,
      );
      return;
    }
    chooseEntry.current(entry);
    setPicker(undefined);
    setInspecting(undefined);
  }, [props.entryRequest, props.notify, state.entries, current, projectId]);
  useEffect(() => {
    if (!active) {
      setPicker(undefined);
      setInspecting(undefined);
      setAcquiring(undefined);
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
              acquire={() => setAcquiring(setup.path)}
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
              onAdd={(entry) => {
                if (
                  scope.current.path === acquiring &&
                  scope.current.active &&
                  scope.current.acquiring === acquiring
                )
                  setup.addEntry(entry);
              }}
              onClose={() => setAcquiring(undefined)}
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
