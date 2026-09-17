/**
 * extension/entrypoints/sidepanel/main.ts
 * Sidepanel extension page entrypoint.
 * Exposes kernelService, pipelineRunner, checkpoint, and auto managers (D-5, D-6, RQ-04, M3 A-1, M4).
 *
 * NOTE (M3 A-1): In production, the sidepanel UI may be closed. All runtime cross-origin
 * fetch operations (gmFetch) and background message dispatching are owned exclusively by
 * the background Service Worker (background.ts). Sidepanel does not duplicate message listeners.
 */

import {
  kernelService,
  pipelineRunner,
  loadCheckpoint,
  saveCheckpoint,
  clearCheckpoint,
  loadAuto,
  armAuto,
  disarmAuto,
  tickAutoLoad,
} from '../../kernel';
import { siteRegistry } from '../../registry';
import { getPlatformAdapter, setInjectedHudScript } from '../../platform';
import type { ProjectStore } from '../../platform/interface';
import { OpfsProjectStore } from '../../project/opfs';
import { MemoryProjectStore } from '../../project/memory';
import { DiskProjectStore } from '../../project/disk';
import { createMockDirectoryHandle } from '../../project/disk-mock';
import { NotebookModuleLinker } from '../../project/linker';
import { runStoreConformance } from '../../project/conformance-runner';
import { loadNotebookCells, parseNotebookMarkdown } from '../../project/notebook-parser';
import { mountSidePanel, SidePanelApp, createStepsFromNotebook, type StepItem } from '../../ui/panel';
import { updateInPageHud, removeInPageHud, renderHudHtml, INJECTED_HUD_SCRIPT } from '../../ui/hud';
import { composeSelectorCandidates, formatPickCall, getComposerRuntimeSource, MAX_DISPLAYED_CANDIDATES } from '../../kernel/selectors';
import { deepCorpusHtml, DEEP_CORPUS_SIBLING_COUNT, DEEP_CORPUS_TARGET_INDEX } from '../../testing/deep-corpus';
import { renderCandidateList, getPickerCellSource, getSearchCellSource } from '../../ui/picker';
import { recordRun, listRuns, readRun, generateRunFileName } from '../../agent/runs';
import { processAgentRequestFile } from '../../agent/processor';
import { agentWatcher, AgentWatcher } from '../../agent/watcher';
import { nativeBridge, NativeBridge } from '../../native/bridge';
import { ALL_EXAMPLE_NOTEBOOKS, NOTEBOOK_COMPLETED, NOTEBOOK_SKIPPED, NOTEBOOK_NEEDS_REVIEW, NOTEBOOK_SESSION_DEAD } from '../../native/fixtures';

setInjectedHudScript(INJECTED_HUD_SCRIPT);

console.log('[dogear] Sidepanel extension page initialized');
const g = (typeof window !== 'undefined' ? window : globalThis) as Record<string, unknown>;
g.__nbKernelService = kernelService;
g.__nbPipelineRunner = pipelineRunner;
g.__nbPlatformAdapter = getPlatformAdapter();
g.__nbCheckpoint = { loadCheckpoint, saveCheckpoint, clearCheckpoint };
g.__nbAuto = { loadAuto, armAuto, disarmAuto, tickAutoLoad };
g.__nbSiteRegistry = siteRegistry;
g.__nbOpfsStore = new OpfsProjectStore();
g.__nbMemoryStore = new MemoryProjectStore();
g.__nbDiskProjectStore = DiskProjectStore;
g.__nbCreateMockDirectoryHandle = createMockDirectoryHandle;
g.__nbNotebookModuleLinker = NotebookModuleLinker;
g.__nbRunStoreConformance = runStoreConformance;
g.__nbLoadNotebookCells = loadNotebookCells;
g.__nbParseNotebookMarkdown = parseNotebookMarkdown;
g.__nbCreateStepsFromNotebook = createStepsFromNotebook;
g.__nbUpdateInPageHud = updateInPageHud;
g.__nbRemoveInPageHud = removeInPageHud;
g.__nbRenderHudHtml = renderHudHtml;
g.__nbMountSidePanel = mountSidePanel;
g.__nbComposeSelectorCandidates = composeSelectorCandidates;
g.__nbFormatPickCall = formatPickCall;
g.__nbRenderCandidateList = renderCandidateList;
g.__nbMaxDisplayedCandidates = MAX_DISPLAYED_CANDIDATES;
g.__nbGetPickerCellSource = getPickerCellSource;
g.__nbGetComposerRuntimeSource = getComposerRuntimeSource;
g.__nbDeepCorpusHtml = deepCorpusHtml();
g.__nbDeepCorpusMeta = { siblingCount: DEEP_CORPUS_SIBLING_COUNT, targetIndex: DEEP_CORPUS_TARGET_INDEX };
g.__nbGetSearchCellSource = getSearchCellSource;
g.__nbSidePanelApp = SidePanelApp;
g.__nbAgentRuns = { recordRun, listRuns, readRun, generateRunFileName };
g.__nbAgent = { processAgentRequestFile, agentWatcher, AgentWatcher };
g.__nbNativeBridge = nativeBridge;
g.__nbNativeBridgeClass = NativeBridge;
g.__nbNativeFixtures = { ALL_EXAMPLE_NOTEBOOKS, NOTEBOOK_COMPLETED, NOTEBOOK_SKIPPED, NOTEBOOK_NEEDS_REVIEW, NOTEBOOK_SESSION_DEAD };

// Auto-mount sidepanel UI with real platform state (D-1, D-2, RQ-01, RQ-02, RQ-03)
if (typeof document !== 'undefined') {
  const root = document.getElementById('root');
  if (root) {
    const platform = getPlatformAdapter();

    let currentActiveTab: { id?: number; host?: string; url?: string } | undefined;

    const updatePanelState = async (tab?: { id?: number; host?: string; url?: string }, reloadNotebook = true) => {
      if (tab) {
        currentActiveTab = tab;
      }
      let activeTab = currentActiveTab;
      if (!activeTab && platform.getActiveTab) {
        try {
          activeTab = await platform.getActiveTab();
          currentActiveTab = activeTab;
        } catch {}
      }

      const rawHost = activeTab?.host;
      const currentSite = rawHost && rawHost.trim() !== '' ? rawHost : 'tab tidak diketahui';
      const isRegistered = rawHost ? await siteRegistry.isRegistered(rawHost) : false;
      const hasUserScripts = platform.isUserScriptsAvailable
        ? platform.isUserScriptsAvailable()
        : (platform.capabilities.hasUserScripts ?? true);

      const store = ((g.__nbCurrentStore || g.__nbOpfsStore) as ProjectStore) || new OpfsProjectStore();
      const props: Parameters<typeof mountSidePanel>[1] = {
        tabId: activeTab?.id,
        currentSite,
        isRegistered,
        hasUserScripts,
        // folderPermissionState dilepas ke 'granted' di M11 karena store default adalah OPFS (lihat kontrak §9).
        folderPermissionState: 'granted',
        projectStore: store,
        onRegisterSite: async (site: string) => {
          await siteRegistry.add(site);
          updatePanelState(activeTab, false);
        },
        onOpenEditor: (filePath: string) => {
          if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
            const url = chrome.runtime.getURL('/editor.html') + (filePath ? `?file=${encodeURIComponent(filePath)}` : '');
            chrome.tabs.create({ url });
          }
        },
        onNotebookCreated: async () => {
          await updatePanelState(activeTab, true);
        },
        onStepSaved: async () => {
          await updatePanelState(activeTab, true);
        },
        onStepsChanged: async () => {
          await updatePanelState(activeTab, true);
        },
      };

      if (reloadNotebook) {
        let steps: StepItem[] = [];
        let notebookExists = false;
        let notebookName = '';
        let notebookError: string | null = null;

        try {
          const hasNotebook = await store.exists('notebook.md');
          if (hasNotebook) {
            const md = await store.readFile('notebook.md');
            const parsed = parseNotebookMarkdown(md);
            notebookName = parsed.name;
            steps = createStepsFromNotebook(parsed);
            notebookExists = true;
          }
        } catch (err: unknown) {
          notebookExists = false;
          notebookError = err instanceof Error ? err.message : String(err);
        }

        let orphanFiles: string[] = [];
        try {
          const allFiles = await store.listFiles('steps');
          const registeredPaths = new Set(steps.map(s => s.source || s.id));
          orphanFiles = allFiles
            .filter(f => f.kind === 'file' && f.path.endsWith('.js') && !registeredPaths.has(f.path))
            .map(f => f.path);
        } catch {}

        props.steps = steps;
        props.notebookExists = notebookExists;
        props.notebookName = notebookName;
        props.notebookError = notebookError;
        props.orphanFiles = orphanFiles;
      }

      const currentRoot = document.getElementById('root') || root;
      mountSidePanel(currentRoot, props);
    };

    g.__nbSidePanelUpdate = updatePanelState;

    // Initial mount with real active tab and permissions
    updatePanelState();

    // Subscribe to tab activation and navigation updates (D-2)
    if (platform.onActiveTabChanged) {
      platform.onActiveTabChanged((tabInfo) => {
        updatePanelState(tabInfo, false);
      });
    }
  }
}

// Ensure messaging is enabled for user scripts when sidepanel is active
if (typeof chrome !== 'undefined' && chrome.userScripts?.configureWorld) {
  chrome.userScripts.configureWorld({ messaging: true }).catch(() => {});
}
