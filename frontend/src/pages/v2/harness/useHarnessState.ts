import { useDeferredValue, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  HarnessAuthStatus,
  HarnessToolId,
  HarnessToolStatus,
  PiWebAccessStatus,
  UpdatePiWebAccessConfigInput,
} from '../../../api/types';
import { v2Api } from '../../../api/v2';
import type { HarnessUpdateEvent } from '../../../api/v2';

export type UpdateLogEntry = {
  id: number;
  event: string;
  text: string;
};

export type WebAccessForm = {
  provider: string;
  workflow: string;
  searchModel: string;
  chromeProfile: string;
  curatorTimeoutSeconds: string;
  githubCloneEnabled: boolean;
  githubCloneMaxRepoSizeMB: string;
  githubCloneTimeoutSeconds: string;
  githubClonePath: string;
  youtubeEnabled: boolean;
  youtubePreferredModel: string;
  videoEnabled: boolean;
  videoPreferredModel: string;
  videoMaxSizeMB: string;
};

export type WebAccessSecretDrafts = {
  exa: string;
  perplexity: string;
  gemini: string;
  clearExa: boolean;
  clearPerplexity: boolean;
  clearGemini: boolean;
};

export const WEB_ACCESS_PACKAGE_SOURCE = 'npm:pi-web-access';

export const EMPTY_WEB_ACCESS_SECRETS: WebAccessSecretDrafts = {
  exa: '',
  perplexity: '',
  gemini: '',
  clearExa: false,
  clearPerplexity: false,
  clearGemini: false,
};

const EMPTY_TOOLS: HarnessToolStatus[] = [];
const EMPTY_AUTH_STATUSES: HarnessAuthStatus[] = [];

export function useHarnessState() {
  const queryClient = useQueryClient();
  const [globalSettingsDraft, setGlobalSettingsDraft] = useState('');
  const [modelsDraft, setModelsDraft] = useState('');
  const [packageSource, setPackageSource] = useState('');
  const [extensionPath, setExtensionPath] = useState('');
  const [webAccessForm, setWebAccessForm] = useState<WebAccessForm>(() => webAccessFormFromStatus());
  const [webAccessSecrets, setWebAccessSecrets] = useState<WebAccessSecretDrafts>(EMPTY_WEB_ACCESS_SECRETS);
  const [latestRequested, setLatestRequested] = useState(false);
  const [activeUpdate, setActiveUpdate] = useState<HarnessToolId | null>(null);
  const [dialogTool, setDialogTool] = useState<HarnessToolId | null>(null);
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
  const [updateLog, setUpdateLog] = useState<UpdateLogEntry[]>([]);
  const deferredPackageSource = useDeferredValue(packageSource.trim());
  const deferredExtensionPath = useDeferredValue(extensionPath.trim());

  const { data: piConfig } = useQuery({
    queryKey: ['v2-pi-config'],
    queryFn: () => v2Api.getPiConfig(),
  });
  const { data: harnessStatus } = useQuery({
    queryKey: ['harness-status'],
    queryFn: () => v2Api.getHarnessStatus(latestRequested),
  });

  useEffect(() => {
    if (!piConfig) return;
    setGlobalSettingsDraft(piConfig.globalSettings.content);
    setModelsDraft(piConfig.models.content);
    setWebAccessForm(webAccessFormFromStatus(piConfig.webAccess));
    setWebAccessSecrets(EMPTY_WEB_ACCESS_SECRETS);
  }, [piConfig]);

  const refreshHarnessState = async () => {
    await queryClient.invalidateQueries({ queryKey: ['harness-status'] });
    await queryClient.invalidateQueries({ queryKey: ['v2-pi-config'] });
    await queryClient.invalidateQueries({ queryKey: ['pi-status'] });
  };

  const saveGlobalSettings = useMutation({ mutationFn: () => v2Api.updatePiSettings(globalSettingsDraft), onSuccess: refreshHarnessState });
  const saveModels = useMutation({ mutationFn: () => v2Api.updatePiModels(modelsDraft), onSuccess: refreshHarnessState });
  const installGlobalPackage = useMutation({
    mutationFn: (source: string) => v2Api.installPiPackage(source),
    onSuccess: async () => {
      setPackageSource('');
      await refreshHarnessState();
    },
  });
  const removeGlobalPackage = useMutation({ mutationFn: (source: string) => v2Api.removePiPackage(source), onSuccess: refreshHarnessState });
  const updateGlobalPackages = useMutation({ mutationFn: () => v2Api.updatePiPackages(), onSuccess: refreshHarnessState });
  const installWebAccess = useMutation({ mutationFn: () => v2Api.installPiPackage(WEB_ACCESS_PACKAGE_SOURCE), onSuccess: refreshHarnessState });
  const removeWebAccess = useMutation({ mutationFn: () => v2Api.removePiPackage(WEB_ACCESS_PACKAGE_SOURCE), onSuccess: refreshHarnessState });
  const updateWebAccess = useMutation({ mutationFn: () => v2Api.updatePiPackages(WEB_ACCESS_PACKAGE_SOURCE), onSuccess: refreshHarnessState });
  const saveWebAccess = useMutation({
    mutationFn: () => v2Api.updatePiWebAccessConfig(buildWebAccessConfigInput(webAccessForm, webAccessSecrets)),
    onSuccess: async () => {
      setWebAccessSecrets(EMPTY_WEB_ACCESS_SECRETS);
      await refreshHarnessState();
    },
  });
  const addGlobalExtension = useMutation({
    mutationFn: (path: string) => v2Api.addPiExtension(path),
    onSuccess: async () => {
      setExtensionPath('');
      await refreshHarnessState();
    },
  });
  const removeGlobalExtension = useMutation({ mutationFn: (path: string) => v2Api.removePiExtension(path), onSuccess: refreshHarnessState });

  const checkLatestVersions = useMutation({
    mutationFn: () => v2Api.getHarnessStatus(true),
    onMutate: () => {
      setLatestRequested(true);
    },
    onSuccess: (status) => {
      queryClient.setQueryData(['harness-status'], status);
    },
  });

  const addUpdateLog = (event: HarnessUpdateEvent) => {
    const text = event.event === 'done' ? formatDoneEvent(event.data) : event.data;
    if (!text.trim()) return;
    setUpdateLog((current) => [...current, { id: Date.now() + current.length, event: event.event, text }].slice(-300));
  };

  const updateHarness = useMutation({
    mutationFn: async (tool: HarnessToolId) => {
      setActiveUpdate(tool);
      setDialogTool(tool);
      setUpdateDialogOpen(true);
      setUpdateLog([]);
      const exitCode = await v2Api.streamHarnessUpdate(tool, addUpdateLog);
      if (exitCode !== 0) {
        throw new Error(`Update exited with code ${exitCode}`);
      }
      return exitCode;
    },
    onSettled: async () => {
      setActiveUpdate(null);
      await refreshHarnessState();
    },
  });

  const runningTool = activeUpdate ?? harnessStatus?.update?.tool ?? null;
  const updateLocked = updateHarness.isPending || Boolean(harnessStatus?.update?.running);
  const updateDialogVisible = updateDialogOpen && (updateLocked || updateLog.length > 0 || updateHarness.error instanceof Error);

  return {
    piConfig,
    harnessStatus,
    tools: harnessStatus?.tools ?? EMPTY_TOOLS,
    authStatuses: harnessStatus?.auth ?? EMPTY_AUTH_STATUSES,
    globalSettingsDraft,
    setGlobalSettingsDraft,
    modelsDraft,
    setModelsDraft,
    packageSource,
    setPackageSource,
    extensionPath,
    setExtensionPath,
    webAccessForm,
    setWebAccessForm,
    webAccessSecrets,
    setWebAccessSecrets,
    deferredPackageSource,
    deferredExtensionPath,
    runningTool,
    updateLocked,
    updateDialogVisible,
    dialogTool,
    updateLog,
    setUpdateDialogOpen,
    mutations: {
      saveGlobalSettings,
      saveModels,
      installGlobalPackage,
      removeGlobalPackage,
      updateGlobalPackages,
      installWebAccess,
      removeWebAccess,
      updateWebAccess,
      saveWebAccess,
      addGlobalExtension,
      removeGlobalExtension,
      checkLatestVersions,
      updateHarness,
    },
  };
}

export type HarnessState = ReturnType<typeof useHarnessState>;

function webAccessFormFromStatus(status?: PiWebAccessStatus): WebAccessForm {
  return {
    provider: status?.provider || 'auto',
    workflow: status?.configExists ? status.workflow || 'summary-review' : 'none',
    searchModel: status?.searchModel ?? '',
    chromeProfile: status?.chromeProfile ?? '',
    curatorTimeoutSeconds: status?.curatorTimeoutSeconds ? String(status.curatorTimeoutSeconds) : '',
    githubCloneEnabled: status?.githubClone.enabled ?? true,
    githubCloneMaxRepoSizeMB: status?.githubClone.maxRepoSizeMB ? String(status.githubClone.maxRepoSizeMB) : '',
    githubCloneTimeoutSeconds: status?.githubClone.cloneTimeoutSeconds ? String(status.githubClone.cloneTimeoutSeconds) : '',
    githubClonePath: status?.githubClone.clonePath ?? '',
    youtubeEnabled: status?.youtube.enabled ?? true,
    youtubePreferredModel: status?.youtube.preferredModel ?? '',
    videoEnabled: status?.video.enabled ?? true,
    videoPreferredModel: status?.video.preferredModel ?? '',
    videoMaxSizeMB: status?.video.maxSizeMB ? String(status.video.maxSizeMB) : '',
  };
}

function buildWebAccessConfigInput(form: WebAccessForm, secrets: WebAccessSecretDrafts): UpdatePiWebAccessConfigInput {
  const input: UpdatePiWebAccessConfigInput = {
    provider: form.provider,
    workflow: form.workflow,
    searchModel: form.searchModel.trim(),
    chromeProfile: form.chromeProfile.trim(),
    githubClone: {
      enabled: form.githubCloneEnabled,
      maxRepoSizeMB: optionalNumber(form.githubCloneMaxRepoSizeMB),
      cloneTimeoutSeconds: optionalNumber(form.githubCloneTimeoutSeconds),
      clonePath: form.githubClonePath.trim(),
    },
    youtube: {
      enabled: form.youtubeEnabled,
      preferredModel: form.youtubePreferredModel.trim(),
    },
    video: {
      enabled: form.videoEnabled,
      preferredModel: form.videoPreferredModel.trim(),
      maxSizeMB: optionalNumber(form.videoMaxSizeMB),
    },
  };
  const timeout = optionalNumber(form.curatorTimeoutSeconds);
  if (timeout !== undefined) input.curatorTimeoutSeconds = timeout;
  if (secrets.exa.trim()) input.exaApiKey = secrets.exa.trim();
  if (secrets.perplexity.trim()) input.perplexityApiKey = secrets.perplexity.trim();
  if (secrets.gemini.trim()) input.geminiApiKey = secrets.gemini.trim();
  if (secrets.clearExa) input.clearExaApiKey = true;
  if (secrets.clearPerplexity) input.clearPerplexityApiKey = true;
  if (secrets.clearGemini) input.clearGeminiApiKey = true;
  return input;
}

function optionalNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.round(parsed);
}

function formatDoneEvent(data: string) {
  try {
    const parsed = JSON.parse(data) as { exitCode?: number };
    return `exit code ${parsed.exitCode ?? 0}`;
  } catch {
    return data;
  }
}
