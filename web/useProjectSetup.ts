import { useCallback, useEffect, useRef, useState } from 'react';
import type { Entry, Finding, Project, Provider } from '../src/core/model';
import { slug } from '../src/core/names';
import type { PlanView } from '../src/core/plan-view';
import type { Recommendation } from '../src/core/recommend';
import { api } from './api';
import { useDraftGuard } from './drafts';
import { t } from './i18n';
import type { PageProps } from './main';
import type { CurrentProject, KitEntryRequest } from './project-context';
import { readProjectDraft, writeProjectDraft } from './project-draft';
import { rememberProject } from './recent-projects';
import { setupSelection } from './setup-selection';

export interface SetupDetection {
  project: Project;
  presetId: string;
  recommendations: Recommendation[];
  missing: string[];
  warnings?: string[];
  guidanceIssues?: { id: string; name: string; findings: Finding[] }[];
  applicableRuleIds?: string[];
  previousSetup?: {
    providers: Provider[];
    entryIds: string[];
    requirements: string;
    presetId?: string;
    manifestMatches: boolean;
  };
}
export interface SetupProps extends PageProps {
  initialPath: string;
  initialRequest?: number;
  active?: boolean;
  onCurrentProjectChange?: (project?: CurrentProject) => void;
  entryRequest?: KitEntryRequest;
}

function classificationSignature(project?: Project): string {
  return JSON.stringify(
    project
      ? {
          path: project.path,
          name: project.name,
          stacks: project.stacks,
          dependencies: project.dependencies,
        }
      : null,
  );
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
  const [recoveryDraft, setRecoveryDraft] = useState(readProjectDraft);
  const [recoveryUnavailable, setRecoveryUnavailable] = useState(false);
  const request = useRef<{ generation: number; controller?: AbortController }>({ generation: 0 });
  const edits = useRef(new Map<string, boolean>());
  const providerEdited = useRef(false);
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
  const knownProject = state.projects.find((project) => project.id === detected?.project.id);
  const inspectedClassification = classificationSignature(detected?.project);
  const projectClassification = knownProject
    ? classificationSignature(knownProject)
    : inspectedClassification;
  const previousProject = useRef<{ id: string; classification: string } | undefined>(undefined);
  useEffect(() => {
    if (edited && path)
      setRecoveryUnavailable(
        !writeProjectDraft({
          version: 1,
          path,
          requirements,
          preset,
          providers,
          selected,
          updatedAt: new Date().toISOString(),
        }),
      );
  }, [edited, path, requirements, preset, providers, selected]);
  useEffect(() => {
    if (previousGuidance.current !== guidanceSignature && path) invalidate();
    previousGuidance.current = guidanceSignature;
  }, [guidanceSignature, path, invalidate]);
  useEffect(() => {
    const id = detected?.project.id;
    if (
      id &&
      previousProject.current?.id === id &&
      previousProject.current.classification !== projectClassification &&
      projectClassification !== inspectedClassification
    )
      invalidate();
    previousProject.current = id ? { id, classification: projectClassification } : undefined;
  }, [detected?.project.id, projectClassification, inspectedClassification, invalidate]);

  async function inspect(
    projectPath = path,
    nextRequirements = requirements,
    nextPreset = preset,
    restorePrevious = false,
    restoredSelection?: string[],
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
          restorePrevious,
        },
        controller.signal,
      );
      if (generation !== request.current.generation || controller.signal.aborted) return;
      setDetected(result);
      rememberProject(result.project.id);
      setNeedsInspection(false);
      if (restoredSelection) {
        edits.current = new Map(
          entries.current.map((entry) => [entry.id, restoredSelection.includes(entry.id)]),
        );
        setSelected(restoredSelection);
        return;
      }
      if (restorePrevious && result.previousSetup) {
        providerEdited.current = true;
        setProviders(result.previousSetup.providers);
        updateRequirements(result.previousSetup.requirements);
        updatePreset(result.previousSetup.presetId === result.presetId ? result.presetId : 'auto');
        edits.current = new Map(result.previousSetup.entryIds.map((id) => [id, true]));
        setSelected(result.previousSetup.entryIds);
        return;
      }
      if (!providerEdited.current && nextPreset !== 'auto') {
        const defaults = state.presets.find((item) => item.id === result.presetId)?.providers;
        if (defaults) setProviders([...defaults]);
      }
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
      writeProjectDraft();
      setRecoveryDraft(undefined);
      setRecoveryUnavailable(false);
      invalidate();
      edits.current.clear();
      setPath(target);
      setCandidatePath(target);
      updateRequirements('');
      updatePreset('auto');
      setProviders(state.settings.defaultProviders);
      providerEdited.current = false;
      setSelected([]);
      setDetected(undefined);
      setOptionsOpen(false);
      setAgentsOpen(false);
      setEdited(false);
      setReplaceExisting(false);
      setPlan(undefined);
      void inspect(target, '', 'auto', true);
    };
    if (edited) {
      setCandidatePath(path);
      guard(proceed);
    } else proceed();
  }
  const chooseRef = useRef(chooseProject);
  chooseRef.current = chooseProject;
  function startNewProject(): void {
    const proceed = () => {
      writeProjectDraft();
      setRecoveryDraft(undefined);
      setRecoveryUnavailable(false);
      cancelPending();
      edits.current.clear();
      setPath('');
      setCandidatePath('');
      updateRequirements('');
      updatePreset('auto');
      setProviders(state.settings.defaultProviders);
      providerEdited.current = false;
      setSelected([]);
      setDetected(undefined);
      setNeedsInspection(false);
      setInspectionError('');
      setOptionsOpen(false);
      setAgentsOpen(false);
      setEdited(false);
      setReplaceExisting(false);
      setPlan(undefined);
    };
    if (edited) guard(proceed);
    else proceed();
  }
  function resumeDraft(): void {
    if (!recoveryDraft) return;
    const draft = recoveryDraft;
    cancelPending();
    setPath(draft.path);
    setCandidatePath(draft.path);
    updateRequirements(draft.requirements);
    updatePreset(
      draft.preset === 'auto' || state.presets.some((item) => item.id === draft.preset)
        ? draft.preset
        : 'auto',
    );
    setProviders(draft.providers);
    providerEdited.current = true;
    setSelected(draft.selected);
    setEdited(true);
    setRecoveryDraft(undefined);
    setRecoveryUnavailable(false);
    void inspect(
      draft.path,
      draft.requirements,
      state.presets.some((item) => item.id === draft.preset) ? draft.preset : 'auto',
      false,
      draft.selected,
    );
  }
  function discardRecoveryDraft(): void {
    writeProjectDraft();
    setRecoveryDraft(undefined);
    setRecoveryUnavailable(false);
  }
  const resetRef = useRef(startNewProject);
  resetRef.current = startNewProject;
  useEffect(() => {
    if (initialRequest === 0 && !initialPath) return;
    if (initialPath) chooseRef.current(initialPath);
    else resetRef.current();
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
    if (!providerEdited.current)
      setProviders([
        ...(state.presets.find((item) => item.id === value)?.providers ||
          state.settings.defaultProviders),
      ]);
    setEdited(true);
    invalidate();
  }
  function toggleProvider(provider: Provider): void {
    providerEdited.current = true;
    setEdited(true);
    setReviewed(false);
    setProviders((current) =>
      current.includes(provider)
        ? current.filter((value) => value !== provider)
        : [...current, provider],
    );
  }
  function adoptPresetAgents(providers: Provider[]): void {
    providerEdited.current = true;
    setEdited(true);
    setReviewed(false);
    setProviders([...providers]);
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
  function addEntry(entry: Pick<Entry, 'id' | 'kind' | 'name'>): void {
    if (entry.kind !== 'skill' && entry.kind !== 'mcp') return;
    setEdited(true);
    setReviewed(false);
    setSelected((current) => {
      if (current.includes(entry.id)) return current;
      const retained = current.filter((id) => {
        const other = entries.current.find((item) => item.id === id);
        const conflict = other?.kind === entry.kind && slug(other.name) === slug(entry.name);
        if (conflict) edits.current.set(id, false);
        return !conflict;
      });
      edits.current.set(entry.id, true);
      return [...retained, entry.id];
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
    if (currentDraft.current !== signature) {
      void refresh().catch((error) => notify((error as Error).message, true));
      return;
    }
    writeProjectDraft();
    setRecoveryDraft(undefined);
    setRecoveryUnavailable(false);
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
    startNewProject,
    changeCandidate,
    changeRequirements,
    changePreset,
    toggleProvider,
    adoptPresetAgents,
    toggleEntry,
    addEntry,
    recoveryDraft,
    recoveryUnavailable,
    resumeDraft,
    discardRecoveryDraft,
    inspect,
    prepare,
    applied,
  };
}
export type SetupController = ReturnType<typeof useProjectSetup>;
