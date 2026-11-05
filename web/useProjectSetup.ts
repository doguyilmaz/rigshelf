import { useCallback, useEffect, useRef, useState } from 'react';
import type { Finding, Project, Provider } from '../src/core/model';
import { slug } from '../src/core/names';
import type { PlanView } from '../src/core/plan-view';
import type { Recommendation } from '../src/core/recommend';
import { api } from './api';
import { useDraftGuard } from './drafts';
import { t } from './i18n';
import type { PageProps } from './main';
import { setupSelection } from './setup-selection';

export interface SetupDetection {
  project: Project;
  presetId: string;
  recommendations: Recommendation[];
  missing: string[];
  warnings?: string[];
  guidanceIssues?: { id: string; name: string; findings: Finding[] }[];
}
export interface SetupProps extends PageProps {
  initialPath: string;
  initialRequest?: number;
  active?: boolean;
}

export function useProjectSetup({
  state,
  notify,
  refresh,
  initialPath,
  initialRequest = 0,
  active = true,
}: SetupProps) {
  const [path, setPath] = useState('');
  const [candidatePath, setCandidatePath] = useState(initialPath);
  const [requirements, updateRequirements] = useState('');
  const [preset, updatePreset] = useState('auto');
  const [providers, setProviders] = useState<Provider[]>(state.settings.defaultProviders);
  const [selected, setSelected] = useState<string[]>([]);
  const [detected, setDetected] = useState<SetupDetection>();
  const [busy, setBusy] = useState(false);
  const [needsInspection, setNeedsInspection] = useState(false);
  const [inspectionError, setInspectionError] = useState('');
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [agentsOpen, setAgentsOpen] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [plan, setPlan] = useState<PlanView>();
  const [edited, setEdited] = useState(false);
  const request = useRef<{ generation: number; controller?: AbortController }>({ generation: 0 });
  const edits = useRef(new Map<string, boolean>());
  const entries = useRef(state.entries);
  entries.current = state.entries;
  const signature = JSON.stringify({
    path,
    candidatePath,
    requirements,
    preset,
    providers,
    selected,
    replaceExisting,
    reviewed,
  });
  const currentDraft = useRef(signature);
  currentDraft.current = signature;
  const [savedDraft, setSavedDraft] = useState(signature);
  const guard = useDraftGuard(!plan && signature !== savedDraft, t('Project setup'), {
    retainOnNavigate: true,
  });
  const cancelPending = useCallback(() => {
    request.current.generation++;
    request.current.controller?.abort();
    setBusy(false);
    setReviewed(false);
  }, []);
  const invalidate = useCallback(() => {
    cancelPending();
    setNeedsInspection(true);
  }, [cancelPending]);
  const guidanceSignature = JSON.stringify({
    rules: state.rules,
    presets: state.presets,
    findings: state.ruleFindings,
  });
  const previousGuidance = useRef(guidanceSignature);
  useEffect(() => {
    if (previousGuidance.current !== guidanceSignature && path) invalidate();
    previousGuidance.current = guidanceSignature;
  }, [guidanceSignature, path, invalidate]);

  async function inspect(
    projectPath = path,
    nextRequirements = requirements,
    nextPreset = preset,
  ): Promise<void> {
    request.current.controller?.abort();
    const controller = new AbortController();
    const generation = ++request.current.generation;
    request.current.controller = controller;
    setBusy(true);
    setInspectionError('');
    setReviewed(false);
    try {
      const result = await api<SetupDetection>(
        'detect',
        'POST',
        {
          projectPath,
          requirements: nextRequirements,
          ...(nextPreset !== 'auto' ? { presetId: nextPreset } : {}),
        },
        controller.signal,
      );
      if (generation !== request.current.generation || controller.signal.aborted) return;
      setDetected(result);
      setNeedsInspection(false);
      setSelected((current) => [
        ...setupSelection(
          result.recommendations.filter((item) => item.selected).map((item) => item.entry.id),
          edits.current,
          entries.current,
        ),
        ...current.filter((id) => !entries.current.some((entry) => entry.id === id)),
      ]);
      if (!result.project.stacks.length) setOptionsOpen(true);
    } catch (error) {
      if (generation !== request.current.generation || controller.signal.aborted) return;
      setInspectionError(error instanceof Error ? error.message : t('Could not inspect project'));
      setNeedsInspection(true);
    } finally {
      if (generation === request.current.generation) setBusy(false);
    }
  }

  function chooseProject(next: string): void {
    const target = next.trim();
    if (!target) return;
    if (target === path) {
      setCandidatePath(target);
      void inspect();
      return;
    }
    const proceed = () => {
      invalidate();
      edits.current.clear();
      setPath(target);
      setCandidatePath(target);
      updateRequirements('');
      updatePreset('auto');
      setProviders(state.settings.defaultProviders);
      setSelected([]);
      setDetected(undefined);
      setOptionsOpen(false);
      setAgentsOpen(false);
      setEdited(false);
      setReplaceExisting(false);
      setPlan(undefined);
      void inspect(target, '', 'auto');
    };
    if (edited) {
      setCandidatePath(path);
      guard(proceed);
    } else proceed();
  }
  const chooseRef = useRef(chooseProject);
  chooseRef.current = chooseProject;
  useEffect(() => {
    if (initialRequest === 0 && !initialPath) return;
    if (initialPath) chooseRef.current(initialPath);
  }, [initialPath, initialRequest]);
  useEffect(
    () => () => {
      request.current.generation++;
      request.current.controller?.abort();
    },
    [],
  );
  useEffect(() => {
    if (!active) {
      setPlan(undefined);
      setOptionsOpen(false);
      setAgentsOpen(false);
    }
  }, [active]);

  function changeCandidate(value: string): void {
    setCandidatePath(value);
    if (value !== path) cancelPending();
  }
  function changeRequirements(value: string): void {
    updateRequirements(value);
    setEdited(true);
    invalidate();
  }
  function changePreset(value: string): void {
    updatePreset(value);
    setEdited(true);
    invalidate();
  }
  function toggleProvider(provider: Provider): void {
    setEdited(true);
    setReviewed(false);
    setProviders((current) =>
      current.includes(provider)
        ? current.filter((value) => value !== provider)
        : [...current, provider],
    );
  }
  function toggleEntry(id: string): void {
    const entry = state.entries.find((value) => value.id === id);
    setEdited(true);
    setReviewed(false);
    if (!entry) {
      edits.current.delete(id);
      setSelected((current) => current.filter((value) => value !== id));
      return;
    }
    setSelected((current) => {
      const enabled = !current.includes(id);
      edits.current.set(id, enabled);
      if (!enabled) return current.filter((value) => value !== id);
      const retained = current.filter((value) => {
        const other = state.entries.find((item) => item.id === value);
        const conflict = other?.kind === entry.kind && slug(other?.name || '') === slug(entry.name);
        if (conflict) edits.current.set(value, false);
        return !conflict;
      });
      return [...retained, id];
    });
  }
  async function prepare(): Promise<void> {
    if (
      !detected ||
      needsInspection ||
      candidatePath.trim() !== path ||
      busy ||
      !providers.length ||
      selected.some((id) => !state.entries.some((entry) => entry.id === id))
    )
      return;
    const generation = request.current.generation;
    const requestedDraft = signature;
    setBusy(true);
    try {
      const prepared = await api<PlanView>('plans', 'POST', {
        projectPath: path,
        requirements,
        presetId: detected?.presetId || undefined,
        providers,
        entryIds: selected,
        includeRules: true,
        allowReviewed: reviewed,
        replaceExisting,
      });
      if (generation === request.current.generation && requestedDraft === currentDraft.current)
        setPlan(prepared);
    } catch (error) {
      if (generation === request.current.generation) notify((error as Error).message, true);
    } finally {
      if (generation === request.current.generation) setBusy(false);
    }
  }
  function applied(): void {
    setSavedDraft(
      JSON.stringify({
        path,
        candidatePath,
        requirements,
        preset,
        providers,
        selected,
        replaceExisting,
        reviewed: false,
      }),
    );
    setEdited(false);
    setReviewed(false);
    void refresh().catch((error) => notify((error as Error).message, true));
  }
  return {
    path,
    candidatePath,
    requirements,
    preset,
    providers,
    selected,
    detected,
    busy,
    needsInspection,
    inspectionError,
    optionsOpen,
    setOptionsOpen,
    agentsOpen,
    setAgentsOpen,
    reviewed,
    setReviewed,
    replaceExisting,
    changeReplacement: (value: boolean) => {
      setEdited(true);
      setReviewed(false);
      setReplaceExisting(value);
    },
    plan,
    setPlan,
    chooseProject,
    changeCandidate,
    changeRequirements,
    changePreset,
    toggleProvider,
    toggleEntry,
    inspect,
    prepare,
    applied,
  };
}
export type SetupController = ReturnType<typeof useProjectSetup>;
