import { h, render, Component } from 'preact';
import { generateTokenStyles } from './tokens';
import { evaluateCellOutcome } from '../native/outcome';
import { RUNTIME_HELPERS } from '../kernel/helpers';
import { getPickerCellSource, getSearchCellSource, renderCandidateList } from './picker';
import type { PluralSelector, SelectorCandidate } from '../kernel/selectors';
import type { ProjectStore } from '../platform/interface';
import { loadNotebookCells, parseNotebookMarkdown, serializeNotebookMarkdown } from '../project/notebook-parser';
import { NotebookModuleLinker } from '../project/linker';


export interface StepItem {
  id: string;
  name: string;
  source: string;
  enabled: boolean;
  order: number;
  output?: string;
  status?: 'idle' | 'running' | 'ok' | 'error' | 'skipped';
  error?: string;
  durationMs?: number;
  warning?: string;
  candidateIndex?: number;
  candidates?: string[];
}

export interface SidePanelProps {
  steps?: StepItem[];
  currentSite?: string;
  tabId?: number;
  isRegistered?: boolean;
  projectStore?: ProjectStore;
  notebookExists?: boolean;
  notebookName?: string;
  notebookError?: string | null;
  onNotebookCreated?: (name: string) => void | Promise<void>;
  onStepSaved?: (step: StepItem) => void | Promise<void>;
  onStepsChanged?: (steps: StepItem[]) => void | Promise<void>;
  onRunStep?: (stepId: string) => Promise<void>;
  onRunAll?: () => Promise<void>;
  onRegisterSite?: (site: string) => void | Promise<void>;
  onOpenEditor?: (filePath: string) => void;
  onRestoreFolderPermission?: () => void | Promise<void>;
  onEnableUserScripts?: () => void;
  hasUserScripts?: boolean;
  folderPermissionState?: 'granted' | 'prompt' | 'denied';
  orphanFiles?: string[];
}

export interface ScratchEntry {
  id: string;
  input: string;
  output: string;
  isError: boolean;
  host?: string;
  tabId?: number;
}

export interface SidePanelState {
  steps: StepItem[];
  selectedStepId: string | null;
  runningStepId: string | null;
  isRunningAll: boolean;
  currentSite: string;
  isRegistered: boolean;
  hasUserScripts: boolean;
  folderPermissionState: 'granted' | 'prompt' | 'denied';
  lastError: string | null;
  collapsedStepIds: Record<string, boolean>;
  scratchInput: string;
  scratchRunning: boolean;
  scratchHistory: string[];
  scratchHistoryIndex: number;
  scratchDraftInput: string;
  scratchEntries: ScratchEntry[];
  helpOpen: boolean;
  drawerMode: 'help' | 'search' | 'results';
  pointing: boolean;
  searchQuery: string;
  pickerCandidates: SelectorCandidate[];
  pickerPlurals: PluralSelector[];
  emptyNoticeCollapsed: boolean;
  notebookExists: boolean;
  notebookName: string;
  notebookError: string | null;
  newNotebookName: string;
  createNotebookError: string | null;
  isCreatingNotebook: boolean;
  newStepName: string;
  isSavingStep: boolean;
  saveStepError: string | null;
  isRepairingNotebook?: boolean;
  repairNotebookError?: string | null;
  orphanFiles: string[];
}

const PANEL_EXTRA_CSS = `
        * {
          scrollbar-width: thin;
          scrollbar-color: var(--nb-color-border) transparent;
        }
        ::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }
        ::-webkit-scrollbar-track {
          background: transparent;
        }
        ::-webkit-scrollbar-thumb {
          background: var(--nb-color-border);
          border-radius: var(--nb-radius-sm);
        }
        ::-webkit-scrollbar-thumb:hover {
          background: var(--nb-color-text-muted);
        }
        .nb-panel {
          display: flex;
          flex-direction: column;
          height: 100vh;
          width: 100%;
          background: var(--nb-color-bg);
          color: var(--nb-color-text);
          font-family: var(--nb-font-mono);
          font-size: var(--nb-font-size-base);
          line-height: var(--nb-line-height-normal);
          overflow: hidden;
        }
        .nb-header {
          flex: 0 0 auto;
          display: flex;
          align-items: center;
          gap: var(--nb-spacing-gap);
          padding: var(--nb-spacing-header-top) var(--nb-spacing-content-x) var(--nb-spacing-header-bottom) var(--nb-spacing-content-x);
          color: var(--nb-color-text-muted);
        }
        .nb-brand {
          color: var(--nb-color-prompt);
          font-weight: 700;
        }
        .nb-site-status {
          color: inherit;
        }
        .nb-tab-mismatch {
          color: var(--nb-color-warning);
        }
        .nb-scratch-entry-host {
          color: var(--nb-color-text-muted);
          margin-left: auto;
        }
        .nb-drawer-title {
          color: inherit;
          font-weight: inherit;
        }
        .nb-banner {
          padding: 0 var(--nb-spacing-content-x) var(--nb-spacing-sm);
          font-size: var(--nb-font-size-base);
        }
        .nb-banner-warning {
          color: var(--nb-color-warning);
        }
        .nb-banner-error {
          color: var(--nb-color-error);
        }
        .nb-banner-title {
          font-weight: 500;
        }
        .nb-banner-body {
          color: var(--nb-color-text-body);
        }
        .nb-btn-restore {
          margin-top: var(--nb-spacing-xs);
        }
        .nb-body {
          flex: 1 1 auto;
          min-height: 0;
          padding: 0 var(--nb-spacing-content-x);
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }
        .nb-transcript {
          flex: 1 1 auto;
          min-height: 0;
          overflow-y: auto;
          overscroll-behavior: contain;
        }
        .nb-run-prompt {
          color: var(--nb-color-prompt);
          background: none;
          border: none;
          padding: 0;
          margin: 0;
          font-family: inherit;
          font-size: inherit;
          line-height: inherit;
          cursor: pointer;
          text-align: left;
        }
        .nb-run-prompt:disabled {
          color: var(--nb-color-text-inactive);
          cursor: not-allowed;
        }
        .nb-step-list {
          display: flex;
          flex-direction: column;
        }
        .nb-step-item {
          margin-top: var(--nb-spacing-header-top);
        }
        .nb-step-item + .nb-step-item {
          margin-top: var(--nb-spacing-step);
        }
        .nb-step-item.selected {
          border-left: 2px solid var(--nb-color-accent);
          padding-left: 4px;
        }
        .nb-step-item.disabled,
        .nb-step-item[data-outcome="inactive"] {
          color: var(--nb-color-text-inactive);
        }
        .nb-step-item[data-outcome="skipped"] {
          color: var(--nb-color-text-muted);
        }
        .nb-step-kind {
          flex: 0 0 auto;
        }
        .nb-step-row {
          display: flex;
          gap: var(--nb-spacing-gap);
          align-items: flex-start;
        }
        .nb-step-glyph {
          flex: 0 0 auto;
        }
        .nb-step-glyph-ok {
          color: var(--nb-color-success);
        }
        .nb-step-glyph-error {
          color: var(--nb-color-error);
        }
        .nb-step-name {
          flex: 1;
          font-weight: 500;
          color: var(--nb-color-text-step);
        }
        .nb-step-item.disabled .nb-step-name {
          color: inherit;
          font-weight: 400;
        }
        .nb-step-run {
          flex: 0 0 auto;
          background: none;
          border: none;
          padding: 0;
          margin: 0;
          color: var(--nb-color-prompt);
          font-family: inherit;
          font-size: inherit;
          line-height: inherit;
          cursor: pointer;
        }
        .nb-step-run:disabled {
          color: var(--nb-color-text-inactive);
          cursor: not-allowed;
        }
        .nb-step-duration {
          color: var(--nb-color-text-subtle);
          flex: 0 0 auto;
        }
        .nb-step-action-btn {
          flex: 0 0 auto;
          background: none;
          border: none;
          padding: 0 2px;
          margin: 0;
          color: var(--nb-color-text-muted);
          font-family: inherit;
          font-size: var(--nb-font-size-sm);
          line-height: inherit;
          cursor: pointer;
        }
        .nb-step-action-btn:hover:not(:disabled) {
          color: var(--nb-color-text-bright);
        }
        .nb-step-action-btn:disabled {
          color: var(--nb-color-text-inactive);
          cursor: not-allowed;
          opacity: 0.3;
        }
        .nb-fold {
          color: var(--nb-color-text-fold);
          flex: 0 0 auto;
          width: var(--nb-spacing-fold);
          height: var(--nb-spacing-fold);
          display: flex;
          align-items: center;
          justify-content: center;
          border: var(--nb-border-thin);
          margin: -3px 0;
          background: none;
          padding: 0;
          font-family: inherit;
          font-size: inherit;
          line-height: 1;
          cursor: pointer;
        }
        .nb-step-warning {
          padding-left: var(--nb-spacing-indent);
          color: var(--nb-color-warning);
        }
        .nb-step-body {
          display: block;
        }
        .nb-step-item[data-collapsed="true"] .nb-step-body {
          display: none;
        }
        .nb-step-output {
          padding-left: var(--nb-spacing-indent);
          white-space: pre-wrap;
          overflow-wrap: anywhere;
        }
        .nb-output-error {
          color: var(--nb-color-error-name);
        }
        .nb-output-ok {
          color: var(--nb-color-text-bright);
        }
        .nb-empty-state {
          display: flex;
          flex-direction: column;
        }
        .nb-empty-state[data-collapsed="true"] {
          flex: 0 0 auto;
        }
        .nb-empty-head {
          display: flex;
          gap: var(--nb-spacing-gap);
          color: var(--nb-color-warning);
        }
        .nb-empty-title {
          flex: 1;
        }
        .nb-empty-desc {
          margin-top: var(--nb-spacing-md);
          color: var(--nb-color-text-body);
        }
        .nb-empty-steps-label {
          margin-top: var(--nb-spacing-xl);
          color: var(--nb-color-text-label);
        }
        .nb-empty-steps {
          margin-top: var(--nb-spacing-xs);
          display: grid;
          grid-template-columns: 16px 1fr;
          gap: 3px 6px;
          color: var(--nb-color-text-bright);
        }
        .nb-empty-step-n {
          color: var(--nb-color-text-subtle);
        }
        .nb-empty-hl {
          color: var(--nb-color-prompt);
        }
        .nb-empty-footnote {
          margin-top: 22px;
          color: var(--nb-color-text-subtle);
          font-size: var(--nb-font-size-sm);
        }
        .nb-create-notebook-section {
          margin-top: var(--nb-spacing-md);
          display: flex;
          flex-direction: column;
          gap: var(--nb-spacing-xs);
        }
        .nb-create-notebook-row {
          display: flex;
          gap: var(--nb-spacing-xs);
        }
        .nb-input-notebook-name {
          flex: 1;
          background: var(--nb-color-bg);
          color: var(--nb-color-text-bright);
          border: 1px solid var(--nb-color-border);
          border-radius: var(--nb-radius-sm);
          padding: 4px 6px;
          font-family: inherit;
          font-size: var(--nb-font-size-sm);
        }
        .nb-input-notebook-name:focus {
          outline: none;
          border-color: var(--nb-color-prompt);
        }
        .nb-btn-create-notebook {
          background: var(--nb-color-bg);
          color: var(--nb-color-text-bright);
          border: 1px solid var(--nb-color-border);
          border-radius: var(--nb-radius-sm);
          padding: 4px 8px;
          cursor: pointer;
          font-family: inherit;
          font-size: var(--nb-font-size-sm);
        }
        .nb-btn-create-notebook:hover:not(:disabled) {
          border-color: var(--nb-color-prompt);
          color: var(--nb-color-prompt);
        }
        .nb-btn-create-notebook:disabled {
          color: var(--nb-color-text-subtle);
          cursor: not-allowed;
        }
        .nb-create-notebook-error {
          color: var(--nb-color-error);
          font-size: var(--nb-font-size-sm);
          margin-top: 4px;
        }
        .nb-scratch-save-row {
          display: flex;
          align-items: center;
          gap: var(--nb-spacing-xs);
          margin-top: 6px;
        }
        .nb-scratch-save-label {
          color: var(--nb-color-text-subtle);
          font-size: var(--nb-font-size-sm);
          flex: 0 0 auto;
        }
        .nb-input-step-name {
          flex: 1;
          background: var(--nb-color-bg);
          color: var(--nb-color-text-bright);
          border: 1px solid var(--nb-color-border);
          border-radius: var(--nb-radius-sm);
          padding: 3px 6px;
          font-family: inherit;
          font-size: var(--nb-font-size-sm);
        }
        .nb-input-step-name:focus {
          outline: none;
          border-color: var(--nb-color-prompt);
        }
        .nb-btn-save-scratch-step {
          background: var(--nb-color-bg);
          color: var(--nb-color-text-bright);
          border: 1px solid var(--nb-color-border);
          border-radius: var(--nb-radius-sm);
          padding: 3px 8px;
          cursor: pointer;
          font-family: inherit;
          font-size: var(--nb-font-size-sm);
          white-space: nowrap;
        }
        .nb-btn-save-scratch-step:hover:not(:disabled) {
          border-color: var(--nb-color-prompt);
          color: var(--nb-color-prompt);
        }
        .nb-btn-save-scratch-step:disabled {
          color: var(--nb-color-text-subtle);
          cursor: not-allowed;
        }
        .nb-save-step-error {
          color: var(--nb-color-error);
          font-size: var(--nb-font-size-sm);
          margin-top: 4px;
        }
        .nb-empty-notebook {
          padding: var(--nb-spacing-md) 0;
          color: var(--nb-color-text-muted);
          font-size: var(--nb-font-size-sm);
        }
        .nb-empty-notebook-title {
          color: var(--nb-color-text-bright);
          font-weight: bold;
          margin-bottom: 4px;
        }
        .nb-empty-notebook-desc {
          color: var(--nb-color-text-body);
        }
        .nb-broken-notebook {
          padding: var(--nb-spacing-md) 0;
          color: var(--nb-color-text-muted);
          font-size: var(--nb-font-size-sm);
        }
        .nb-broken-notebook-desc {
          color: var(--nb-color-text-body);
        }
        .nb-broken-notebook-warning {
          margin-top: var(--nb-spacing-sm);
          color: var(--nb-color-warning);
          font-size: var(--nb-font-size-sm);
          line-height: var(--nb-line-height-normal);
        }
        .nb-btn-repair-notebook {
          display: inline-block;
          margin-top: var(--nb-spacing-sm);
          padding: var(--nb-spacing-xs) var(--nb-spacing-md);
          background: var(--nb-color-surface);
          border: 1px solid var(--nb-color-border);
          color: var(--nb-color-text);
          font-family: inherit;
          font-size: var(--nb-font-size-sm);
          cursor: pointer;
        }
        .nb-btn-repair-notebook:hover:not(:disabled) {
          background: var(--nb-color-surface-hover);
        }
        .nb-btn-repair-notebook:disabled {
          opacity: 0.58;
          cursor: not-allowed;
        }
        .nb-orphan-section {
          margin-top: var(--nb-spacing-md);
          padding: var(--nb-spacing-sm) var(--nb-spacing-md);
          background: var(--nb-color-surface);
          border: 1px solid var(--nb-color-border);
          font-size: var(--nb-font-size-sm);
        }
        .nb-orphan-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: var(--nb-spacing-xs);
        }
        .nb-orphan-title {
          color: var(--nb-color-warning);
          font-weight: bold;
        }
        .nb-orphan-desc {
          color: var(--nb-color-text-muted);
          margin-bottom: var(--nb-spacing-sm);
        }
        .nb-orphan-list {
          display: flex;
          flex-direction: column;
          gap: var(--nb-spacing-xs);
        }
        .nb-orphan-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--nb-spacing-sm);
          padding: var(--nb-spacing-xs) 0;
          border-top: 1px solid var(--nb-color-border-subtle);
        }
        .nb-orphan-path {
          color: var(--nb-color-text-body);
          font-family: var(--nb-font-mono);
          font-size: var(--nb-font-size-xs);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .nb-orphan-actions {
          display: flex;
          gap: var(--nb-spacing-xs);
          flex-shrink: 0;
        }
        .nb-btn-adopt-orphan,
        .nb-btn-delete-orphan {
          padding: var(--nb-spacing-xxs) var(--nb-spacing-sm);
          background: var(--nb-color-bg);
          border: 1px solid var(--nb-color-border);
          color: var(--nb-color-text);
          font-family: inherit;
          font-size: var(--nb-font-size-xs);
          cursor: pointer;
        }
        .nb-btn-adopt-orphan:hover,
        .nb-btn-delete-orphan:hover {
          background: var(--nb-color-surface-hover);
        }
        .nb-scratch {
          flex: 0 1 auto;
          min-height: 0;
          max-height: 100%;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          margin-top: var(--nb-spacing-scratch);
          border-top: var(--nb-border-subtle);
          padding-top: var(--nb-spacing-lg);
          padding-bottom: var(--nb-spacing-lg);
        }
        .nb-empty-state .nb-scratch {
          margin-top: 18px;
          padding-top: 14px;
        }
        .nb-scratch-label {
          flex: 0 0 auto;
          display: flex;
          align-items: baseline;
          gap: var(--nb-spacing-gap);
          color: var(--nb-color-text-subtle);
          font-size: var(--nb-font-size-sm);
        }
        .nb-scratch-aside {
          flex: 0 0 auto;
          color: var(--nb-color-text-label);
        }
        .nb-scratch-copy {
          margin-top: var(--nb-spacing-sm);
          color: var(--nb-color-text-body);
        }
        .nb-scratch-history {
          flex: 1 1 auto;
          min-height: 0;
          overflow-y: auto;
          overscroll-behavior: contain;
          display: flex;
          flex-direction: column;
          gap: var(--nb-spacing-sm);
          margin-top: var(--nb-spacing-sm);
          margin-bottom: var(--nb-spacing-xs);
        }
        .nb-scratch-entry {
          display: flex;
          flex-direction: column;
        }
        .nb-scratch-history-input {
          flex: 1;
          white-space: pre-wrap;
          color: var(--nb-color-text-muted);
        }
        .nb-scratch-clear {
          background: none;
          border: none;
          padding: 0;
          margin: 0 0 0 auto;
          color: var(--nb-color-text-bright);
          font-family: inherit;
          font-size: inherit;
          line-height: inherit;
          cursor: pointer;
        }
        .nb-scratch-clear:disabled {
          color: var(--nb-color-text-inactive);
          cursor: not-allowed;
        }
        .nb-scratch-row {
          flex: 0 0 auto;
          margin-top: var(--nb-spacing-sm);
          display: flex;
          align-items: flex-start;
          gap: var(--nb-spacing-gap);
        }
        .nb-scratch-prompt {
          color: var(--nb-color-prompt);
          flex: 0 0 auto;
        }
        .nb-scratch-input {
          flex: 1;
          background: none;
          border: none;
          padding: 0;
          margin: 0;
          color: var(--nb-color-text);
          font-family: inherit;
          font-size: inherit;
          line-height: inherit;
          outline: none;
          resize: none;
          overflow-y: hidden;
          box-sizing: border-box;
          min-height: 4.5em;
        }
        .nb-scratch-input::placeholder {
          color: var(--nb-color-text-inactive);
        }
        .nb-scratch-hint {
          flex: 0 0 auto;
          margin-top: var(--nb-spacing-md);
          color: var(--nb-color-text-subtle);
          font-size: var(--nb-font-size-sm);
        }
        .nb-scratch-hint-key {
          color: var(--nb-color-prompt);
        }
        .nb-scratch-out {
          padding-left: var(--nb-spacing-indent);
          color: var(--nb-color-text-bright);
          white-space: pre-wrap;
          overflow-wrap: anywhere;
        }
        .nb-summary {
          margin-top: 14px;
          color: var(--nb-color-text-muted);
        }
        .nb-footer-dot {
          color: var(--nb-color-error);
        }
        .nb-footer {
          flex: 0 0 auto;
          padding: var(--nb-spacing-header-bottom) var(--nb-spacing-content-x);
          color: var(--nb-color-text-footer);
          font-size: var(--nb-font-size-sm);
          display: flex;
          gap: var(--nb-spacing-content-x);
          flex-wrap: nowrap;
          white-space: nowrap;
          align-items: center;
        }
        .nb-footer-key {
          color: var(--nb-color-text-bright);
        }
        .nb-footer-run {
          background: none;
          border: none;
          padding: 0;
          margin: 0;
          color: var(--nb-color-text-bright);
          font-family: inherit;
          font-size: inherit;
          line-height: inherit;
          cursor: pointer;
        }
        .nb-footer-run:disabled {
          color: var(--nb-color-text-inactive);
          cursor: not-allowed;
        }
        .nb-footer-help {
          margin-left: auto;
          cursor: pointer;
          user-select: none;
        }
        .nb-footer-help:hover {
          color: var(--nb-color-text-bright);
        }
        .nb-footer-btn {
          background: none;
          border: none;
          padding: 0;
          margin: 0;
          color: var(--nb-color-text-bright);
          font-family: inherit;
          font-size: inherit;
          line-height: inherit;
          cursor: pointer;
        }
        .nb-footer-btn:disabled {
          color: var(--nb-color-text-inactive);
          cursor: not-allowed;
        }
        .nb-help-drawer {
          flex: 0 0 auto;
          max-height: 330px;
          min-height: 0;
          background: var(--nb-color-bg);
          border-top: 1px solid var(--nb-color-border);
          display: flex;
          flex-direction: column;
        }
        .nb-help-header {
          flex: 0 0 auto;
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: var(--nb-spacing-sm) var(--nb-spacing-md);
          border-bottom: 1px solid var(--nb-color-border);
          font-weight: bold;
          color: var(--nb-color-text-bright);
        }
        .nb-help-close {
          background: none;
          border: none;
          color: var(--nb-color-text-muted);
          cursor: pointer;
          font-family: inherit;
          font-size: var(--nb-font-size-base);
          padding: 2px 6px;
        }
        .nb-help-close:hover {
          color: var(--nb-color-text-bright);
        }
        .nb-help-body {
          flex: 1 1 auto;
          min-height: 0;
          padding: var(--nb-spacing-md);
          overflow-y: auto;
          overscroll-behavior: contain;
          display: flex;
          flex-direction: column;
          gap: var(--nb-spacing-md);
          scrollbar-width: thin;
        }
        .nb-help-item {
          display: flex;
          flex-direction: column;
          gap: var(--nb-spacing-xs);
        }
        .nb-help-example {
          color: var(--nb-color-prompt);
        }
        .nb-help-more {
          flex: 0 0 auto;
          padding: var(--nb-spacing-sm) var(--nb-spacing-md);
          color: var(--nb-color-text-muted);
          font-size: var(--nb-font-size-sm);
          border-top: 1px solid var(--nb-color-border);
        }
        .nb-drawer-search {
          flex-direction: row;
          align-items: center;
          gap: var(--nb-spacing-md);
        }
        .nb-drawer-modes {
          display: flex;
          gap: var(--nb-spacing-md);
          font-weight: 400;
          color: var(--nb-color-text-muted);
        }
        .nb-drawer-mode {
          background: none;
          border: none;
          padding: 0;
          margin: 0;
          color: inherit;
          font-family: inherit;
          font-size: inherit;
          cursor: pointer;
        }
        .nb-drawer-mode[data-active="true"] {
          color: var(--nb-color-text-bright);
          font-weight: 700;
        }
        .nb-help-sig {
          font-family: var(--nb-font-mono);
          color: var(--nb-color-accent);
          margin: 0;
          font-size: var(--nb-font-size-base);
        }
        .nb-help-desc {
          color: var(--nb-color-text-body);
          font-size: var(--nb-font-size-sm);
          margin: 0;
        }
        .nb-cand-host {
          display: flex;
          flex-direction: column;
        }
        .nb-cand-wrap {
          display: flex;
          flex-direction: column;
          gap: var(--nb-spacing-lg);
        }
        .nb-cand-list {
          display: flex;
          flex-direction: column;
          gap: var(--nb-spacing-gap);
        }
        .nb-cand {
          display: flex;
          align-items: baseline;
          gap: var(--nb-spacing-md);
        }
        .nb-cand-index {
          color: var(--nb-color-text-subtle);
          width: 12px;
          flex: 0 0 auto;
        }
        .nb-cand-selector {
          flex: 1;
          color: var(--nb-color-text);
          word-break: break-word;
        }
        .nb-cand--fragile .nb-cand-selector {
          color: var(--nb-color-text-body);
        }
        .nb-cand-fragile {
          color: var(--nb-color-warning);
          margin-left: var(--nb-spacing-md);
        }
        .nb-cand-count {
          color: var(--nb-color-text-muted);
          flex: 0 0 auto;
        }
        .nb-cand-count--multi {
          color: var(--nb-color-warning);
        }
        .nb-cand-count--list {
          color: var(--nb-color-success);
        }
        .nb-cand-plurals {
          border-top: var(--nb-border-subtle);
          padding-top: 10px;
          display: flex;
          flex-direction: column;
          gap: var(--nb-spacing-gap);
        }
        .nb-cand-plurals-title {
          color: var(--nb-color-text-muted);
          font-size: var(--nb-font-size-sm);
        }
`;

function warningFromResult(res: {
  output?: string;
  candidateIndex?: number;
  candidateMatch?: { candidateIndex: number; candidate: string; candidates: string[] };
}): string | undefined {
  const output = typeof res.output === 'string' ? res.output : '';
  if (!output.includes('[WARNING] Selector shift')) return undefined;
  if (res.candidateIndex === undefined || res.candidateIndex <= 1) return undefined;
  const total = res.candidateMatch?.candidates?.length;
  const cand = res.candidateMatch?.candidate ?? '';
  const totalText = total !== undefined ? String(total) : '?';
  return `! kandidat ${res.candidateIndex}/${totalText}  ${cand}`.trimEnd();
}

function stepGlyph(step: StepItem): { text: string; className: string } {
  if (!step.enabled) return { text: '\u2212', className: 'nb-step-glyph' };
  if (step.status === 'ok') return { text: '\u2713', className: 'nb-step-glyph nb-step-glyph-ok' };
  if (step.status === 'error') return { text: '\u2717', className: 'nb-step-glyph nb-step-glyph-error' };
  if (step.status === 'skipped') return { text: '\u2212', className: 'nb-step-glyph' };
  if (step.status === 'running') return { text: '\u00b7', className: 'nb-step-glyph' };
  return { text: '\u00b7', className: 'nb-step-glyph' };
}

export const SCRATCH_HISTORY_STORAGE_KEY = 'nb:scratch:history';
export const EMPTY_NOTICE_COLLAPSED_STORAGE_KEY = 'nb:empty-notice:collapsed';

function loadScratchHistory(): string[] {
  try {
    if (typeof sessionStorage !== 'undefined') {
      const raw = sessionStorage.getItem(SCRATCH_HISTORY_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed.slice(-50);
      }
    }
  } catch {}
  return [];
}

function saveScratchHistory(history: string[]): void {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(SCRATCH_HISTORY_STORAGE_KEY, JSON.stringify(history.slice(-50)));
    }
  } catch {}
}

function loadEmptyNoticeCollapsed(): boolean {
  try {
    if (typeof sessionStorage !== 'undefined') {
      return sessionStorage.getItem(EMPTY_NOTICE_COLLAPSED_STORAGE_KEY) === '1';
    }
  } catch {}
  return false;
}

function saveEmptyNoticeCollapsed(collapsed: boolean): void {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(EMPTY_NOTICE_COLLAPSED_STORAGE_KEY, collapsed ? '1' : '0');
    }
  } catch {}
}

export const STOP_STALL_MS = 2500;
export const STOP_STALL_MESSAGE =
  'stop tidak menghentikan sel. Pembatalan hanya diperiksa di sela sleep/waitFor/pick — while (true) {} tanpa await tidak bisa disela.';
export const CELL_BUSY_REASON = 'Sedang menjalankan sel — tidak bisa menjalankan yang lain';

type KernelServiceHandle = {
  runCell: (
    cell: { id: string; name: string; source: string },
    options?: Record<string, unknown>
  ) => Promise<{
    ok: boolean;
    aborted?: boolean;
    result?: unknown;
    output?: string;
    error?: unknown;
    candidateIndex?: number;
    candidateMatch?: { candidateIndex: number; candidate: string; candidates: string[] };
  }>;
  cancelCell?: (tabId: number, token?: string) => Promise<void>;
};

export function formatScratchResult(res: {
  ok: boolean;
  result?: unknown;
  output?: string;
  error?: unknown;
  aborted?: boolean;
}): {
  text: string;
  isError: boolean;
} {
  const abortErr = res.error as { name?: string } | undefined;
  if (res.aborted || abortErr?.name === 'AbortError') {
    const text = typeof res.output === 'string' && res.output.trim() !== '' ? res.output : '■ stopped';
    return { text, isError: false };
  }
  if (!res.ok) {
    if (typeof res.output === 'string' && res.output.trim() !== '') {
      return { text: res.output, isError: true };
    }
    const errObj = res.error as { name?: string; message?: string; cause?: string; action?: string } | undefined;
    const name = errObj?.name || 'Error';
    const msg = errObj?.message || String(res.error || 'gagal');
    let out = `✖ ${name}: ${msg}`;
    if (errObj?.cause) out += `\n  Sebab: ${errObj.cause}`;
    if (errObj?.action) out += `\n  Tindakan: ${errObj.action}`;
    return { text: out, isError: true };
  }

  const hasOutput = typeof res.output === 'string' && res.output.trim() !== '';

  if (res.result === undefined) {
    return { text: hasOutput ? res.output! : 'undefined', isError: false };
  }
  if (res.result === null) {
    return { text: hasOutput && !res.output?.endsWith('null') ? `${res.output}\nnull` : 'null', isError: false };
  }
  if (res.result === '') {
    return { text: hasOutput ? `${res.output}\n""` : '""', isError: false };
  }

  let formattedResult: string;
  if (typeof res.result === 'object') {
    try {
      formattedResult = JSON.stringify(res.result, null, 2);
    } catch {
      formattedResult = String(res.result);
    }
  } else {
    formattedResult = String(res.result);
  }

  if (hasOutput) {
    if (res.output === formattedResult || res.output!.endsWith(formattedResult)) {
      return { text: res.output!, isError: false };
    }
    return { text: `${res.output}\n${formattedResult}`, isError: false };
  }

  return { text: formattedResult, isError: false };
}

export class SidePanelApp extends Component<SidePanelProps, SidePanelState> {
  private runAllActive = false;
  private scratchInputEl: HTMLTextAreaElement | null = null;
  private scratchHistoryEl: HTMLElement | null = null;
  private scratchPinnedToBottom = true;
  private scratchTabExitArmed = false;
  private scratchRunTabId: number | undefined;
  private scratchRunHost = '';
  private stepRunTabId: number | undefined;
  private stopWatchdog: ReturnType<typeof setTimeout> | null = null;
  private stopEpoch = 0;
  private stopRequested = false;

  constructor(props: SidePanelProps) {
    super(props);
    const initialHistory = loadScratchHistory();
    this.state = {
      steps: props.steps || [],
      selectedStepId: props.steps?.[0]?.id || null,
      runningStepId: null,
      isRunningAll: false,
      currentSite: props.currentSite || '',
      isRegistered: props.isRegistered ?? true,
      hasUserScripts: props.hasUserScripts ?? true,
      folderPermissionState: props.folderPermissionState || 'granted',
      lastError: null,
      collapsedStepIds: {},
      scratchInput: '',
      scratchRunning: false,
      scratchHistory: initialHistory,
      scratchHistoryIndex: -1,
      scratchDraftInput: '',
      scratchEntries: [],
      helpOpen: false,
      drawerMode: 'help',
      pointing: false,
      searchQuery: '',
      pickerCandidates: [],
      pickerPlurals: [],
      emptyNoticeCollapsed: loadEmptyNoticeCollapsed(),
      notebookExists: props.notebookExists ?? (props.steps !== undefined && props.steps.length > 0),
      notebookName: props.notebookName || '',
      notebookError: props.notebookError || null,
      newNotebookName: '',
      createNotebookError: null,
      isCreatingNotebook: false,
      newStepName: '',
      isSavingStep: false,
      saveStepError: null,
      isRepairingNotebook: false,
      repairNotebookError: null,
      orphanFiles: props.orphanFiles || [],
    };
  }

  private handleGlobalKeyDown = (e: KeyboardEvent) => {
    if (e.key === '?') {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag !== 'input' && tag !== 'textarea') {
        e.preventDefault();
        this.setState((prev) => {
          if (prev.helpOpen && prev.drawerMode === 'help') return { helpOpen: false };
          return { helpOpen: true, drawerMode: 'help' };
        });
      }
    } else if (e.key === 'Escape' && this.state.helpOpen) {
      const escTarget = e.target as HTMLElement | null;
      const tag = escTarget?.tagName?.toLowerCase();
      if (tag === 'textarea' || tag === 'input') return;
      e.preventDefault();
      this.setState({ helpOpen: false });
    }
  };

  componentDidMount() {
    if (typeof document !== 'undefined' && !document.getElementById('nb-tokens-style')) {
      const style = document.createElement('style');
      style.id = 'nb-tokens-style';
      style.textContent = generateTokenStyles() + PANEL_EXTRA_CSS;
      document.head.appendChild(style);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.handleGlobalKeyDown);
    }
    this.refreshOrphanFiles();
  }

  componentDidUpdate() {
    const hist = this.scratchHistoryEl;
    if (hist && this.scratchPinnedToBottom) {
      hist.scrollTop = hist.scrollHeight;
    }
    const t = this.scratchInputEl;
    if (t) {
      t.style.height = 'auto';
      t.style.height = `${t.scrollHeight}px`;
    }
  }

  componentWillUnmount() {
    this.clearStopWatchdog();
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.handleGlobalKeyDown);
    }
  }

  componentWillReceiveProps(nextProps: SidePanelProps) {
    if (nextProps.steps !== undefined) {
      const selectedStillValid = nextProps.steps.some((s) => s.id === this.state.selectedStepId);
      this.setState({
        steps: nextProps.steps,
        selectedStepId: selectedStillValid ? this.state.selectedStepId : (nextProps.steps[0]?.id || null),
        notebookExists: nextProps.notebookExists !== undefined ? nextProps.notebookExists : (nextProps.steps.length > 0),
        notebookName: nextProps.notebookName !== undefined ? nextProps.notebookName : (nextProps.steps.length > 0 ? this.state.notebookName : ''),
      });
    } else {
      if (nextProps.notebookExists !== undefined) {
        this.setState({ notebookExists: nextProps.notebookExists });
      }
      if (nextProps.notebookName !== undefined) {
        this.setState({ notebookName: nextProps.notebookName });
      }
    }
    if (nextProps.notebookError !== undefined) {
      this.setState({ notebookError: nextProps.notebookError });
    }
    if (nextProps.orphanFiles !== undefined) {
      this.setState({ orphanFiles: nextProps.orphanFiles });
    }
    if (nextProps.currentSite !== undefined) {
      this.setState({ currentSite: nextProps.currentSite });
    }
    if (nextProps.isRegistered !== undefined) {
      this.setState({ isRegistered: nextProps.isRegistered });
    }
    if (nextProps.hasUserScripts !== undefined) {
      this.setState({ hasUserScripts: nextProps.hasUserScripts });
    }
    if (nextProps.folderPermissionState !== undefined) {
      this.setState({ folderPermissionState: nextProps.folderPermissionState });
    }
  }

  private refreshOrphanFiles = async () => {
    const g = (typeof window !== 'undefined' ? window : globalThis) as Record<string, unknown>;
    const store = this.props.projectStore || ((g.__nbCurrentStore || g.__nbOpfsStore) as ProjectStore | undefined);
    if (!store) return;

    try {
      const allFiles = await store.listFiles('steps');
      const registeredPaths = new Set(this.state.steps.map(s => s.source || s.id));
      const orphans = allFiles
        .filter(f => f.kind === 'file' && f.path.endsWith('.js') && !registeredPaths.has(f.path))
        .map(f => f.path);
      this.setState({ orphanFiles: orphans });
      this.state = { ...this.state, orphanFiles: orphans };
    } catch {}
  };

  private handleAdoptOrphan = async (path: string) => {
    const g = (typeof window !== 'undefined' ? window : globalThis) as Record<string, unknown>;
    const store = this.props.projectStore || ((g.__nbCurrentStore || g.__nbOpfsStore) as ProjectStore | undefined);
    if (!store) return;

    try {
      let parsed: { name: string; description?: string; allSteps: Array<{ path: string; name?: string; enabled?: boolean; world?: 'MAIN' | 'USER_SCRIPT' }> } = { name: this.state.notebookName || 'Notebook Baru', description: '', allSteps: [] };
      if (await store.exists('notebook.md')) {
        try {
          const rawMd = await store.readFile('notebook.md');
          parsed = parseNotebookMarkdown(rawMd);
        } catch {
          parsed = { name: this.state.notebookName || 'Notebook Baru', description: '', allSteps: [] };
        }
      }

      const basename = path.split('/').pop() || path;
      const withoutExt = basename.replace(/\.[^.]+$/, '');
      const cleanName = withoutExt.replace(/^\d+[-_]?/, '').replace(/[-_]+/g, ' ');
      const displayName = cleanName ? cleanName.charAt(0).toUpperCase() + cleanName.slice(1) : withoutExt;

      const updatedSteps = [
        ...parsed.allSteps,
        { path, name: displayName, enabled: true, world: 'MAIN' as const },
      ];

      const updatedMd = serializeNotebookMarkdown({
        name: parsed.name || 'Notebook Baru',
        description: parsed.description,
        allSteps: updatedSteps,
      });

      await store.writeFile('notebook.md', updatedMd);

      let source = '';
      try {
        source = await store.readFile(path);
      } catch {}

      const newStepItem: StepItem = {
        id: path,
        name: displayName,
        source,
        enabled: true,
        order: updatedSteps.length,
      };

      const remainingOrphans = (this.state.orphanFiles || []).filter(p => p !== path);
      const nextSteps = [...this.state.steps, newStepItem];
      const next = {
        orphanFiles: remainingOrphans,
        steps: nextSteps,
        notebookExists: true,
        notebookError: null,
        notebookName: parsed.name || 'Notebook Baru',
      };

      this.setState(next);
      this.state = { ...this.state, ...next };

      if (this.props.onStepsChanged) {
        await this.props.onStepsChanged(nextSteps);
      }
      if (this.props.onNotebookCreated && !this.state.notebookExists) {
        await this.props.onNotebookCreated(parsed.name || 'Notebook Baru');
      }
    } catch (err) {
      console.error('[panel] Failed to adopt orphan:', err);
    }
  };

  private handleDeleteOrphan = async (path: string) => {
    const g = (typeof window !== 'undefined' ? window : globalThis) as Record<string, unknown>;
    const store = this.props.projectStore || ((g.__nbCurrentStore || g.__nbOpfsStore) as ProjectStore | undefined);
    if (!store) return;

    try {
      await store.deleteFile(path);
      const remainingOrphans = (this.state.orphanFiles || []).filter(p => p !== path);
      this.setState({ orphanFiles: remainingOrphans });
      this.state = { ...this.state, orphanFiles: remainingOrphans };
    } catch (err) {
      console.error('[panel] Failed to delete orphan file:', err);
    }
  };

  private handleOpenEditor = () => {
    const { steps, selectedStepId } = this.state;
    const selectedStep = steps.find((s) => s.id === selectedStepId);
    const targetPath = selectedStep?.source || selectedStep?.id;
    if (targetPath && this.props.onOpenEditor) {
      this.props.onOpenEditor(targetPath);
    }
  };

  private handleCreateNotebook = async () => {
    const inputVal = (typeof document !== 'undefined' ? (document.querySelector('[data-testid="nb-input-notebook-name"]') as HTMLInputElement)?.value : undefined);
    const name = (inputVal !== undefined && inputVal.trim() !== '' ? inputVal : this.state.newNotebookName).trim() || 'Notebook Baru';
    this.setState({ isCreatingNotebook: true, createNotebookError: null, newNotebookName: name });
    this.state = { ...this.state, isCreatingNotebook: true, createNotebookError: null, newNotebookName: name };

    const g = (typeof window !== 'undefined' ? window : globalThis) as Record<string, unknown>;
    const store = this.props.projectStore || ((g.__nbCurrentStore || g.__nbOpfsStore) as ProjectStore | undefined);

    if (!store) {
      const err = 'Gagal membuat notebook: Project store tidak tersedia.';
      this.setState({
        isCreatingNotebook: false,
        createNotebookError: err,
      });
      this.state = { ...this.state, isCreatingNotebook: false, createNotebookError: err };
      return;
    }

    try {
      const content = [
        '---',
        `name: ${name}`,
        'steps: []',
        '---',
        '',
      ].join('\n');

      await store.writeFile('notebook.md', content);

      const next = {
        notebookExists: true,
        notebookName: name,
        steps: [] as StepItem[],
        newNotebookName: '',
        createNotebookError: null,
        isCreatingNotebook: false,
      };
      this.setState(next);
      this.state = { ...this.state, ...next };

      if (this.props.onNotebookCreated) {
        await this.props.onNotebookCreated(name);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const errMsg = `Gagal membuat notebook.md: ${msg}`;
      this.setState({
        isCreatingNotebook: false,
        createNotebookError: errMsg,
      });
      this.state = { ...this.state, isCreatingNotebook: false, createNotebookError: errMsg };
    }
  };

  private handleRepairNotebook = async () => {
    const name = 'Notebook Baru';
    this.setState({ isRepairingNotebook: true, repairNotebookError: null });
    this.state = { ...this.state, isRepairingNotebook: true, repairNotebookError: null };

    const g = (typeof window !== 'undefined' ? window : globalThis) as Record<string, unknown>;
    const store = this.props.projectStore || ((g.__nbCurrentStore || g.__nbOpfsStore) as ProjectStore | undefined);

    if (!store) {
      const err = 'Gagal memperbaiki notebook: Project store tidak tersedia.';
      this.setState({
        isRepairingNotebook: false,
        repairNotebookError: err,
      });
      this.state = { ...this.state, isRepairingNotebook: false, repairNotebookError: err };
      return;
    }

    try {
      const content = [
        '---',
        `name: ${name}`,
        'steps: []',
        '---',
        '',
      ].join('\n');

      await store.writeFile('notebook.md', content);

      const next = {
        notebookExists: true,
        notebookName: name,
        notebookError: null,
        steps: [] as StepItem[],
        repairNotebookError: null,
        isRepairingNotebook: false,
      };
      this.setState(next);
      this.state = { ...this.state, ...next };

      if (this.props.onNotebookCreated) {
        await this.props.onNotebookCreated(name);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const errMsg = `Gagal memperbaiki notebook.md: ${msg}`;
      this.setState({
        isRepairingNotebook: false,
        repairNotebookError: errMsg,
      });
      this.state = { ...this.state, isRepairingNotebook: false, repairNotebookError: errMsg };
    }
  };

  private handleSaveScratchAsStep = async () => {
    if (this.state.notebookError) {
      const err = 'Tidak dapat menyimpan step: notebook.md sedang rusak. Perbaiki notebook terlebih dahulu.';
      this.setState({ saveStepError: err });
      this.state = { ...this.state, saveStepError: err };
      return;
    }

    const inputEl = typeof document !== 'undefined'
      ? (document.querySelector('[data-testid="nb-input-step-name"]') as HTMLInputElement | null)
      : null;
    const nameVal = (inputEl && inputEl.value !== undefined && inputEl.value.trim() !== '' ? inputEl.value : this.state.newStepName).trim();

    const inputArea = typeof document !== 'undefined'
      ? (document.querySelector('[data-testid="nb-scratch-input"]') as HTMLTextAreaElement | null)
      : null;
    const rawCode = (inputArea && inputArea.value !== undefined ? inputArea.value : this.state.scratchInput);

    if (!rawCode.trim()) {
      const err = 'Kotak scratch kosong \u2014 ketik kode terlebih dahulu.';
      this.setState({ saveStepError: err });
      this.state = { ...this.state, saveStepError: err };
      return;
    }

    this.setState({ isSavingStep: true, saveStepError: null });
    this.state = { ...this.state, isSavingStep: true, saveStepError: null };

    const g = (typeof window !== 'undefined' ? window : globalThis) as Record<string, unknown>;
    const store = this.props.projectStore || ((g.__nbCurrentStore || g.__nbOpfsStore) as ProjectStore | undefined);

    if (!store) {
      const err = 'Gagal menyimpan step: Project store tidak tersedia.';
      this.setState({ isSavingStep: false, saveStepError: err });
      this.state = { ...this.state, isSavingStep: false, saveStepError: err };
      return;
    }

    let counter = this.state.steps.length + 1;
    let slug = nameVal.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (!slug) {
      slug = `step-${counter}`;
    }
    const displayName = nameVal || `Step ${counter}`;

    let stepPath = `steps/${String(counter).padStart(2, '0')}-${slug}.js`;
    try {
      while (await store.exists(stepPath)) {
        counter++;
        stepPath = `steps/${String(counter).padStart(2, '0')}-${slug}.js`;
      }
    } catch {}

    // Two writes:
    // Write 1: steps/<nn>-<slug>.js
    try {
      await store.writeFile(stepPath, rawCode);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const fullMsg = `Gagal menulis berkas step (${stepPath}): ${msg}. notebook.md tidak diubah.`;
      this.setState({ isSavingStep: false, saveStepError: fullMsg });
      this.state = { ...this.state, isSavingStep: false, saveStepError: fullMsg };
      return;
    }

    // Write 2: update notebook.md
    try {
      const rawMd = (await store.exists('notebook.md'))
        ? await store.readFile('notebook.md')
        : `---\nname: ${this.state.notebookName || 'Notebook Baru'}\nsteps: []\n---\n`;
      const parsed = parseNotebookMarkdown(rawMd);
      const updatedSteps = [
        ...parsed.allSteps,
        { path: stepPath, name: displayName, enabled: true, world: 'MAIN' as const },
      ];
      const updatedMd = serializeNotebookMarkdown({
        name: parsed.name,
        description: parsed.description,
        allSteps: updatedSteps,
      });
      await store.writeFile('notebook.md', updatedMd);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const fullMsg = `Gagal memperbarui notebook.md: ${msg}. Berkas step ${stepPath} tersimpan sebagai berkas yatim.`;
      this.setState({ isSavingStep: false, saveStepError: fullMsg });
      this.state = { ...this.state, isSavingStep: false, saveStepError: fullMsg };
      return;
    }

    const newStepItem: StepItem = {
      id: stepPath,
      name: displayName,
      source: rawCode,
      enabled: true,
      order: this.state.steps.length + 1,
      status: 'idle',
    };

    if (inputEl) {
      inputEl.value = '';
    }

    const nextSteps = [...this.state.steps, newStepItem];
    const nextState = {
      steps: nextSteps,
      selectedStepId: this.state.selectedStepId || stepPath,
      notebookExists: true,
      notebookName: this.state.notebookName || 'Notebook Baru',
      isSavingStep: false,
      saveStepError: null,
      newStepName: '',
    };
    this.setState(nextState);
    this.state = { ...this.state, ...nextState };

    if (this.props.onStepSaved) {
      await this.props.onStepSaved(newStepItem);
    }
  };

  private handleToggleStepEnabled = async (stepId: string) => {
    const currentSteps = this.state.steps;
    const targetStep = currentSteps.find(s => s.id === stepId);
    if (!targetStep) return;

    const nextEnabled = !targetStep.enabled;
    const nextSteps = currentSteps.map(s => {
      if (s.id === stepId) {
        return { ...s, enabled: nextEnabled };
      }
      return s;
    });

    this.setState({ steps: nextSteps });
    this.state = { ...this.state, steps: nextSteps };

    const g = (typeof window !== 'undefined' ? window : globalThis) as Record<string, unknown>;
    const store = this.props.projectStore || ((g.__nbCurrentStore || g.__nbOpfsStore) as ProjectStore | undefined);

    if (store && await store.exists('notebook.md')) {
      try {
        const rawMd = await store.readFile('notebook.md');
        const parsed = parseNotebookMarkdown(rawMd);
        const updatedSteps = parsed.allSteps.map(s => {
          if (s.path === stepId) {
            return { ...s, enabled: nextEnabled };
          }
          return s;
        });
        const updatedMd = serializeNotebookMarkdown({
          name: parsed.name,
          description: parsed.description,
          allSteps: updatedSteps,
        });
        await store.writeFile('notebook.md', updatedMd);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.setState({ notebookError: `Gagal memperbarui status step di notebook.md: ${msg}` });
      }
    }

    if (this.props.onStepsChanged) {
      await this.props.onStepsChanged(nextSteps);
    }
  };

  private handleMoveStep = async (stepId: string, direction: 'up' | 'down') => {
    const currentSteps = [...this.state.steps];
    const idx = currentSteps.findIndex(s => s.id === stepId);
    if (idx === -1) return;
    if (direction === 'up' && idx === 0) return;
    if (direction === 'down' && idx === currentSteps.length - 1) return;

    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    const item = currentSteps[idx];
    currentSteps.splice(idx, 1);
    currentSteps.splice(targetIdx, 0, item);

    const reorderedSteps = currentSteps.map((s, i) => ({
      ...s,
      order: i + 1,
    }));

    this.setState({ steps: reorderedSteps });
    this.state = { ...this.state, steps: reorderedSteps };

    const g = (typeof window !== 'undefined' ? window : globalThis) as Record<string, unknown>;
    const store = this.props.projectStore || ((g.__nbCurrentStore || g.__nbOpfsStore) as ProjectStore | undefined);

    if (store && await store.exists('notebook.md')) {
      try {
        const rawMd = await store.readFile('notebook.md');
        const parsed = parseNotebookMarkdown(rawMd);
        const parsedIdx = parsed.allSteps.findIndex(s => s.path === stepId);
        if (parsedIdx !== -1) {
          const parsedTargetIdx = direction === 'up' ? parsedIdx - 1 : parsedIdx + 1;
          if (parsedTargetIdx >= 0 && parsedTargetIdx < parsed.allSteps.length) {
            const stepItem = parsed.allSteps[parsedIdx];
            parsed.allSteps.splice(parsedIdx, 1);
            parsed.allSteps.splice(parsedTargetIdx, 0, stepItem);
            const updatedMd = serializeNotebookMarkdown({
              name: parsed.name,
              description: parsed.description,
              allSteps: parsed.allSteps,
            });
            await store.writeFile('notebook.md', updatedMd);
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.setState({ notebookError: `Gagal memperbarui urutan step di notebook.md: ${msg}` });
      }
    }

    if (this.props.onStepsChanged) {
      await this.props.onStepsChanged(reorderedSteps);
    }
  };

  render() {
    const {
      steps,
      selectedStepId,
      runningStepId,
      isRunningAll,
      currentSite,
      hasUserScripts,
      folderPermissionState,
      collapsedStepIds,
      scratchInput,
      scratchRunning,
      scratchEntries,
      helpOpen,
      drawerMode,
      pickerCandidates,
      pickerPlurals,
      emptyNoticeCollapsed,
      orphanFiles,
    } = this.state;
    const empty = steps.length === 0;
    const selectedStep = steps.find((s) => s.id === selectedStepId);
    const currentStepPath = selectedStep ? (selectedStep.source || selectedStep.id) : null;
    const cellBusy = scratchRunning || !!runningStepId || isRunningAll;
    const runTabId = scratchRunning ? this.scratchRunTabId : this.stepRunTabId;
    const viewingDifferentTab = cellBusy && runTabId !== undefined && this.props.tabId !== runTabId;
    const mismatchLabel = this.scratchRunHost && this.scratchRunHost !== currentSite
      ? `berjalan di ${this.scratchRunHost}`
      : 'berjalan di tab lain';

    return h('div', { class: 'nb-panel', 'data-testid': 'nb-sidepanel-root' }, [
      h('header', { class: 'nb-header' }, [
        h('span', { class: 'nb-brand' }, 'dogear'),
        this.state.notebookName ? h('span', { class: 'nb-notebook-name', 'data-testid': 'nb-notebook-name' }, ` \u2022 ${this.state.notebookName}`) : null,
        h('span', {
          class: 'nb-site-status',
          'data-testid': 'nb-site-status',
        }, currentSite || 'no site'),
        viewingDifferentTab && h('span', {
          class: 'nb-tab-mismatch',
          'data-testid': 'nb-tab-mismatch',
          'data-run-tab': String(runTabId),
          'data-view-tab': String(this.props.tabId ?? ''),
        }, mismatchLabel),
      ]),

      this.state.notebookError && h('div', {
        class: 'nb-banner nb-banner-error',
        'data-testid': 'nb-notebook-error',
        role: 'alert',
      }, [
        h('div', { class: 'nb-banner-title' }, 'Notebook Rusak'),
        h('div', { class: 'nb-banner-body' }, `Gagal membaca notebook.md: ${this.state.notebookError}`),
      ]),

      !hasUserScripts && h('div', {
        class: 'nb-banner nb-banner-error',
        'data-testid': 'nb-onboarding-userscripts',
        role: 'alert',
      }, [
        h('div', { class: 'nb-banner-title' }, 'Fitur chrome.userScripts belum aktif'),
        h('div', { class: 'nb-banner-body' },
          'Eksekusi cell di tab membutuhkan izin user scripts. Buka chrome://extensions, aktifkan "Developer mode" di sudut kanan atas, lalu nyalakan toggle "Allow user scripts" pada ekstensi ini.'
        ),
      ]),

      folderPermissionState === 'prompt' && h('div', {
        class: 'nb-banner nb-banner-warning',
        'data-testid': 'nb-onboarding-folder',
        role: 'status',
      }, [
        h('div', { class: 'nb-banner-title' }, 'Akses folder project perlu dipulihkan'),
        h('div', { class: 'nb-banner-body' },
          'Setiap sesi browser baru membutuhkan satu gestur pengguna untuk mengaktifkan kembali handle folder disk/OPFS.'
        ),
        h('button', {
          class: 'nb-btn-restore',
          'data-testid': 'nb-btn-restore-folder',
          onClick: () => this.props.onRestoreFolderPermission?.(),
          'aria-label': 'Pulihkan Akses Folder Project',
        }, 'Pulihkan Akses Folder'),
      ]),

      h('div', { class: 'nb-body' }, [
        h('div', { class: 'nb-transcript' }, [
        !empty && h('button', {
          class: 'nb-run-prompt',
          onClick: () => this.handleRunAll(),
          disabled: cellBusy || steps.length === 0,
          title: cellBusy ? CELL_BUSY_REASON : 'Jalankan semua step',
          'aria-label': cellBusy ? CELL_BUSY_REASON : 'Jalankan Semua Step',
          'data-testid': 'nb-btn-run-all',
        }, isRunningAll ? '> running' : '> run all'),

        h('div', { class: 'nb-step-list', 'data-testid': 'nb-step-list' },
          empty
            ? (this.state.notebookExists
                ? h('div', { class: 'nb-empty-notebook', 'data-testid': 'nb-empty-notebook' }, [
                    h('div', { class: 'nb-empty-notebook-title' },
                      this.state.notebookName
                        ? `Notebook "${this.state.notebookName}" belum memiliki step`
                        : 'Notebook ini belum memiliki step'
                    ),
                    h('div', { class: 'nb-empty-notebook-desc' }, 'Ketik kode di kotak scratch di bawah dan simpan sebagai step.'),
                  ])
                : (this.state.notebookError
                    ? h('div', { class: 'nb-broken-notebook', 'data-testid': 'nb-broken-notebook' }, [
                        h('div', { class: 'nb-broken-notebook-desc' }, 'Notebook tidak dapat dibaca karena berkas rusak.'),
                        h('div', { class: 'nb-broken-notebook-warning', 'data-testid': 'nb-repair-warning' },
                          'Perhatian: Membuat ulang notebook akan menimpa notebook.md yang rusak. Isi lama yang tidak terbaca akan hilang.'
                        ),
                        h('button', {
                          class: 'nb-btn-repair-notebook',
                          'data-testid': 'nb-btn-repair-notebook',
                          disabled: this.state.isRepairingNotebook,
                          onClick: () => this.handleRepairNotebook(),
                        }, this.state.isRepairingNotebook ? 'Memperbaiki...' : 'Buat ulang notebook'),
                        this.state.repairNotebookError && h('div', {
                          class: 'nb-create-notebook-error',
                          'data-testid': 'nb-repair-notebook-error',
                          role: 'alert',
                        }, this.state.repairNotebookError),
                      ])
                    : h('div', {
                    class: 'nb-empty-state',
                    'data-testid': 'nb-empty-state',
                    'data-collapsed': String(emptyNoticeCollapsed),
                  }, [
                    h('div', { class: 'nb-empty-head' }, [
                      h('span', {}, '!'),
                      h('span', { class: 'nb-empty-title', 'data-testid': 'nb-empty-title' }, 'Studio belum terhubung'),
                      h('button', {
                        class: 'nb-fold',
                        'data-testid': 'nb-empty-fold',
                        'aria-label': emptyNoticeCollapsed ? 'Buka pemberitahuan' : 'Kuncupkan pemberitahuan',
                        onClick: () => {
                          const next = !this.state.emptyNoticeCollapsed;
                          saveEmptyNoticeCollapsed(next);
                          this.setState({ emptyNoticeCollapsed: next });
                        },
                      }, emptyNoticeCollapsed ? '\u25B8' : '\u25BE'),
                    ]),
                    !emptyNoticeCollapsed && h('div', { class: 'nb-empty-desc', 'data-testid': 'nb-empty-desc' },
                      'Panel ini menjalankan notebook; yang menyimpan dan mengirimkannya adalah dogear Studio di komputer ini.'
                    ),
                    !emptyNoticeCollapsed && h('div', { class: 'nb-empty-steps-label' }, 'langkahnya'),
                    !emptyNoticeCollapsed && h('div', { class: 'nb-empty-steps', 'data-testid': 'nb-empty-steps' }, [
                      h('span', { class: 'nb-empty-step-n' }, '1'),
                      h('span', {}, ['buka ', h('span', { class: 'nb-empty-hl' }, 'dogear Studio')]),
                      h('span', { class: 'nb-empty-step-n' }, '2'),
                      h('span', {}, ['pilih project, lalu tekan ', h('span', { class: 'nb-empty-hl' }, 'Hubungkan')]),
                      h('span', { class: 'nb-empty-step-n' }, '3'),
                      h('span', {}, 'kembali ke tab ini'),
                    ]),
                    !emptyNoticeCollapsed && h('div', { class: 'nb-create-notebook-section', 'data-testid': 'nb-create-notebook-section' }, [
                      h('div', { class: 'nb-empty-steps-label' }, 'atau buat notebook baru'),
                      h('div', { class: 'nb-create-notebook-row' }, [
                        h('input', {
                          type: 'text',
                          class: 'nb-input-notebook-name',
                          'data-testid': 'nb-input-notebook-name',
                          placeholder: 'Nama notebook...',
                          value: this.state.newNotebookName,
                          onInput: (e: Event) => this.setState({ newNotebookName: (e.target as HTMLInputElement).value }),
                          onKeyDown: (e: KeyboardEvent) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              this.handleCreateNotebook();
                            }
                          },
                        }),
                        h('button', {
                          class: 'nb-btn-create-notebook',
                          'data-testid': 'nb-btn-create-notebook',
                          disabled: this.state.isCreatingNotebook,
                          onClick: () => this.handleCreateNotebook(),
                        }, this.state.isCreatingNotebook ? 'Membuat...' : 'Buat notebook'),
                      ]),
                      this.state.createNotebookError && h('div', {
                        class: 'nb-create-notebook-error',
                        'data-testid': 'nb-create-notebook-error',
                        role: 'alert',
                      }, this.state.createNotebookError),
                    ]),
                    !emptyNoticeCollapsed && h('div', { class: 'nb-empty-footnote' },
                      'Studio berjalan tapi tetap tidak terhubung? Periksa apakah ia dipasang untuk profil browser yang sedang Anda pakai.'
                    ),
                    ])))
            : steps.map((step, idx) => {
                const isRunning = step.id === runningStepId;
                const collapsed = step.status === 'error' ? false : !!collapsedStepIds[step.id];
                const glyph = stepGlyph(step);
                const outcome = !step.enabled
                  ? 'inactive'
                  : (step.status === 'skipped' ? 'skipped' : (step.status || 'idle'));
                return h('div', {
                  key: step.id,
                  class: `nb-step-item ${!step.enabled ? 'disabled' : ''} ${step.id === selectedStepId ? 'selected' : ''}`.trim(),
                  'data-testid': `nb-step-${step.id}`,
                  'data-step-id': step.id,
                  'data-step-enabled': String(step.enabled),
                  'data-outcome': outcome,
                  'data-collapsed': String(collapsed),
                  'data-status': step.status || 'idle',
                  'data-has-warning': String(!!step.warning),
                  onClick: () => this.setState({ selectedStepId: step.id }),
                }, [
                  h('div', { class: 'nb-step-row' }, [
                    h('span', { class: glyph.className }, glyph.text),
                    h('span', {
                      class: 'nb-step-name',
                      tabIndex: 0,
                      'aria-label': `Step ${idx + 1}: ${step.name}`,
                    }, `${idx + 1}. ${step.name}`),
                    !step.enabled && h('span', { class: 'nb-step-kind', 'data-testid': `nb-kind-${step.id}` }, 'nonaktif'),
                    step.enabled && step.status === 'skipped' && h('span', { class: 'nb-step-kind', 'data-testid': `nb-kind-${step.id}` }, 'dilewati'),
                    step.durationMs !== undefined && (step.status === 'ok' || step.status === 'skipped')
                      ? h('span', { class: 'nb-step-duration' }, `${step.durationMs}ms`)
                      : h('button', {
                          class: 'nb-step-run',
                          disabled: cellBusy || !step.enabled,
                          title: cellBusy ? CELL_BUSY_REASON : `Jalankan step ${step.name}`,
                          'aria-label': cellBusy ? CELL_BUSY_REASON : `Jalankan step ${step.name}`,
                          'data-testid': `nb-btn-run-${step.id}`,
                          onClick: (e: Event) => {
                            e.stopPropagation();
                            this.handleRunStep(step.id);
                          },
                        }, isRunning ? '...' : 'run'),
                    h('button', {
                      class: 'nb-step-action-btn nb-step-move-up',
                      'data-testid': `nb-btn-move-up-${step.id}`,
                      'aria-label': `Pindahkan step ${step.name} ke atas`,
                      title: 'Pindahkan ke atas',
                      disabled: cellBusy || idx === 0,
                      onClick: (e: Event) => {
                        e.stopPropagation();
                        this.handleMoveStep(step.id, 'up');
                      },
                    }, '\u2191'),
                    h('button', {
                      class: 'nb-step-action-btn nb-step-move-down',
                      'data-testid': `nb-btn-move-down-${step.id}`,
                      'aria-label': `Pindahkan step ${step.name} ke bawah`,
                      title: 'Pindahkan ke bawah',
                      disabled: cellBusy || idx === steps.length - 1,
                      onClick: (e: Event) => {
                        e.stopPropagation();
                        this.handleMoveStep(step.id, 'down');
                      },
                    }, '\u2193'),
                    h('button', {
                      class: 'nb-step-action-btn nb-step-toggle-btn',
                      'data-testid': `nb-btn-toggle-${step.id}`,
                      'aria-label': step.enabled ? `Nonaktifkan step ${step.name}` : `Aktifkan step ${step.name}`,
                      title: step.enabled ? 'Nonaktifkan step' : 'Aktifkan step',
                      disabled: cellBusy,
                      onClick: (e: Event) => {
                        e.stopPropagation();
                        this.handleToggleStepEnabled(step.id);
                      },
                    }, step.enabled ? 'aktif' : 'nonaktif'),
                    h('button', {
                      class: 'nb-fold',
                      'data-testid': `nb-fold-${step.id}`,
                      'aria-label': collapsed ? 'Buka step' : 'Lipat step',
                      onClick: (e: Event) => {
                        e.stopPropagation();
                        this.toggleCollapsed(step.id);
                      },
                    }, collapsed ? '\u25B8' : '\u25BE'),
                  ]),
                  step.warning && h('div', {
                    class: 'nb-step-warning',
                    'data-testid': `nb-warning-${step.id}`,
                  }, step.warning),
                  step.output !== undefined && h('div', {
                    class: 'nb-step-body',
                    'data-testid': `nb-step-body-${step.id}`,
                  }, [
                    h('div', {
                      class: `nb-step-output ${step.status === 'error' ? 'nb-output-error' : 'nb-output-ok'}`,
                      'data-testid': `nb-output-${step.id}`,
                    }, step.output),
                  ]),
                ]);
               })
        ),
        (orphanFiles && orphanFiles.length > 0) && h('div', { class: 'nb-orphan-section', 'data-testid': 'nb-orphan-section' }, [
          h('div', { class: 'nb-orphan-header' }, [
            h('span', { class: 'nb-orphan-title' }, `Berkas yatim (${orphanFiles.length})`),
          ]),
          h('div', { class: 'nb-orphan-desc' }, 'Ditemukan berkas di steps/ yang belum terdaftar di notebook:'),
          h('div', { class: 'nb-orphan-list' },
            orphanFiles.map((path) =>
              h('div', { class: 'nb-orphan-item', key: path, 'data-testid': 'nb-orphan-item', 'data-path': path }, [
                h('span', { class: 'nb-orphan-path', title: path }, path),
                h('div', { class: 'nb-orphan-actions' }, [
                  h('button', {
                    class: 'nb-btn-adopt-orphan',
                    'data-testid': 'nb-btn-adopt-orphan',
                    'data-path': path,
                    onClick: () => this.handleAdoptOrphan(path),
                  }, 'Pungut jadi step'),
                  h('button', {
                    class: 'nb-btn-delete-orphan',
                    'data-testid': 'nb-btn-delete-orphan',
                    'data-path': path,
                    onClick: () => this.handleDeleteOrphan(path),
                  }, 'Hapus'),
                ]),
              ])
            )
          ),
        ]),
        ]),
        this.renderScratch(empty, scratchInput, scratchRunning, scratchEntries),
      ]),

      helpOpen && h('div', { class: 'nb-help-drawer', 'data-testid': 'nb-help-drawer' }, [
        h('div', { class: 'nb-help-header' }, [
          h('span', { class: 'nb-drawer-title', 'data-testid': 'nb-drawer-title' },
            drawerMode === 'search' ? 'cari' : drawerMode === 'results' ? 'hasil pilih' : 'bantuan helper cell'
          ),
          h('span', { class: 'nb-drawer-modes' }, [
            h('button', {
              class: 'nb-drawer-mode',
              'data-testid': 'nb-drawer-mode-help',
              'data-active': String(drawerMode === 'help'),
              onClick: () => this.setState({ drawerMode: 'help' }),
            }, 'bantuan'),
            h('button', {
              class: 'nb-drawer-mode',
              'data-testid': 'nb-drawer-mode-search',
              'data-active': String(drawerMode === 'search'),
              onClick: () => this.setState({ drawerMode: 'search' }),
            }, 'cari'),
            pickerCandidates.length > 0 && h('button', {
              class: 'nb-drawer-mode',
              'data-testid': 'nb-drawer-mode-results',
              'data-active': String(drawerMode === 'results'),
              onClick: () => this.setState({ drawerMode: 'results' }),
            }, 'hasil'),
          ]),
          h('button', {
            class: 'nb-help-close',
            'data-testid': 'nb-help-close',
            'aria-label': 'Tutup bantuan',
            onClick: () => this.setState({ helpOpen: false }),
          }, '\u2715'),
        ]),
        h('div', { class: 'nb-help-body', 'data-testid': 'nb-help-body', key: drawerMode },
          drawerMode === 'search'
            ? [
                h('div', { class: 'nb-help-item nb-drawer-search', key: 'search-pane', 'data-testid': 'nb-drawer-search' }, [
                  h('input', {
                    class: 'nb-scratch-input',
                    'data-testid': 'nb-picker-search-input',
                    placeholder: 'cari',
                    value: this.state.searchQuery,
                    onInput: (e: Event) => this.setState({ searchQuery: (e.target as HTMLInputElement).value }),
                    onKeyDown: (e: KeyboardEvent) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        this.handleSearch();
                      }
                    },
                  }),
                  h('button', {
                    class: 'nb-footer-run',
                    'data-testid': 'nb-footer-search',
                    'aria-label': 'Cari teks',
                    onClick: () => this.handleSearch(),
                  }, 'cari'),
                ]),
              ]
            : drawerMode === 'results'
              ? [
                  pickerCandidates.length > 0 && h('div', {
                    class: 'nb-cand-host',
                    key: 'results-host',
                    'data-testid': 'nb-picker-result-host',
                    ref: (node: HTMLElement | null) => {
                      if (node) {
                        renderCandidateList(
                          node,
                          pickerCandidates,
                          pickerPlurals,
                          (call) => this.setState({ scratchInput: call }),
                        );
                      }
                    },
                  }),
                ]
              : RUNTIME_HELPERS.map((helper) =>
                  h('div', { class: 'nb-help-item', key: helper.name, 'data-testid': `nb-help-item-${helper.name}` }, [
                    h('code', { class: 'nb-help-sig' }, helper.signature),
                    h('p', { class: 'nb-help-desc' }, helper.description),
                    h('code', {
                      class: 'nb-help-example',
                      'data-testid': `nb-help-example-${helper.name}`,
                    }, helper.example),
                  ])
                )
        ),
        drawerMode === 'help' && h('div', {
          class: 'nb-help-more',
          'data-testid': 'nb-help-more',
        }, 'gulir \u2014 masih ada helper di bawah'),
      ]),

      empty
        ? h('div', { class: 'nb-footer', 'data-testid': 'nb-footer' }, [
            h('span', { class: 'nb-footer-dot' }, '\u25CF'),
            h('span', {}, 'tidak terhubung'),
            h('button', {
              class: 'nb-footer-run',
              'data-testid': 'nb-footer-stop',
              'aria-label': cellBusy ? 'Hentikan sel yang sedang berjalan' : 'Tidak ada sel yang sedang berjalan',
              title: cellBusy ? 'Hentikan sel yang sedang berjalan' : 'Tidak ada sel yang sedang berjalan',
              disabled: !cellBusy,
              onClick: () => this.handleStop(),
            }, 'stop'),
            h('button', {
              class: 'nb-footer-run',
              'data-testid': 'nb-footer-pick',
              'aria-label': cellBusy ? CELL_BUSY_REASON : 'Pilih elemen',
              title: cellBusy ? CELL_BUSY_REASON : 'Pilih elemen',
              disabled: cellBusy || this.state.pointing,
              onClick: () => this.handlePick(),
            }, 'pick'),
            h('button', {
              class: 'nb-footer-btn nb-footer-run',
              'data-testid': 'nb-footer-edit',
              'aria-label': 'Buka editor step',
              disabled: true,
            }, 'edit'),
            h('span', {
              class: 'nb-footer-help',
              'data-testid': 'nb-footer-help',
              onClick: () => this.setState((prev) => {
                if (prev.helpOpen && prev.drawerMode === 'help') return { helpOpen: false };
                return { helpOpen: true, drawerMode: 'help' };
              }),
            }, [
              h('span', { class: 'nb-footer-key' }, '?'),
              ' bantuan',
            ]),
          ])
        : h('div', { class: 'nb-footer', 'data-testid': 'nb-footer' }, [
            h('button', {
              class: 'nb-footer-run',
              onClick: () => this.handleRunAll(),
              disabled: cellBusy || steps.length === 0,
              title: cellBusy ? CELL_BUSY_REASON : 'Jalankan semua step',
              'aria-label': cellBusy ? CELL_BUSY_REASON : 'Jalankan Semua Step',
              'data-testid': 'nb-footer-run',
            }, 'run'),
            h('button', {
              class: 'nb-footer-run',
              'data-testid': 'nb-footer-stop',
              'aria-label': cellBusy ? 'Hentikan sel yang sedang berjalan' : 'Tidak ada sel yang sedang berjalan',
              title: cellBusy ? 'Hentikan sel yang sedang berjalan' : 'Tidak ada sel yang sedang berjalan',
              disabled: !cellBusy,
              onClick: () => this.handleStop(),
            }, 'stop'),
            h('button', {
              class: 'nb-footer-run',
              'data-testid': 'nb-footer-pick',
              'aria-label': cellBusy ? CELL_BUSY_REASON : 'Pilih elemen',
              title: cellBusy ? CELL_BUSY_REASON : 'Pilih elemen',
              disabled: cellBusy || this.state.pointing,
              onClick: () => this.handlePick(),
            }, 'pick'),
            h('button', {
              class: 'nb-footer-btn nb-footer-run',
              'data-testid': 'nb-footer-edit',
              'aria-label': 'Buka editor step',
              disabled: !currentStepPath,
              onClick: () => this.handleOpenEditor(),
            }, 'edit'),
            h('span', {
              class: 'nb-footer-help',
              'data-testid': 'nb-footer-help',
              onClick: () => this.setState((prev) => {
                if (prev.helpOpen && prev.drawerMode === 'help') return { helpOpen: false };
                return { helpOpen: true, drawerMode: 'help' };
              }),
            }, [
              h('span', { class: 'nb-footer-key' }, '?'),
              ' bantuan',
            ]),
          ]),
    ]);
  }

  private navigateScratchHistory(direction: 'up' | 'down', target?: HTMLTextAreaElement) {
    const { scratchHistory, scratchHistoryIndex, scratchDraftInput, scratchInput } = this.state;
    if (scratchHistory.length === 0) return;

    if (direction === 'up') {
      const draft = scratchHistoryIndex === -1 ? scratchInput : scratchDraftInput;
      const nextIndex = scratchHistoryIndex === -1 ? 0 : Math.min(scratchHistoryIndex + 1, scratchHistory.length - 1);
      const text = scratchHistory[scratchHistory.length - 1 - nextIndex];
      this.setState({
        scratchHistoryIndex: nextIndex,
        scratchDraftInput: draft,
        scratchInput: text,
      }, () => {
        if (target) {
          target.style.height = 'auto';
          target.style.height = `${target.scrollHeight}px`;
          target.selectionStart = target.selectionEnd = target.value.length;
        }
      });
    } else {
      if (scratchHistoryIndex === -1) return;
      if (scratchHistoryIndex > 0) {
        const nextIndex = scratchHistoryIndex - 1;
        const text = scratchHistory[scratchHistory.length - 1 - nextIndex];
        this.setState({
          scratchHistoryIndex: nextIndex,
          scratchInput: text,
        }, () => {
          if (target) {
            target.style.height = 'auto';
            target.style.height = `${target.scrollHeight}px`;
            target.selectionStart = target.selectionEnd = target.value.length;
          }
        });
      } else {
        // Return to draft
        this.setState({
          scratchHistoryIndex: -1,
          scratchInput: scratchDraftInput,
        }, () => {
          if (target) {
            target.style.height = 'auto';
            target.style.height = `${target.scrollHeight}px`;
            target.selectionStart = target.selectionEnd = target.value.length;
          }
        });
      }
    }
  }

  private renderScratch(
    empty: boolean,
    scratchInput: string,
    scratchRunning: boolean,
    scratchEntries: ScratchEntry[]
  ) {
    // Pengantar panjang hanya saat pemberitahuan masih mengembang; begitu dikuncupkan ia
    // ikut menyusut jadi satu label, supaya transkrip tidak terus ditagih ruang.
    const showIntro = empty && !this.state.emptyNoticeCollapsed;
    return h('div', { class: 'nb-scratch', 'data-testid': 'nb-scratch' }, [
      h('div', { class: 'nb-scratch-label' }, [
        showIntro
          ? h('span', { class: 'nb-scratch-aside' }, 'sementara itu, yang tetap bisa')
          : h('span', {}, 'coba di halaman ini \u2014 tidak tersimpan ke notebook'),
        h('button', {
          class: 'nb-scratch-clear',
          'data-testid': 'nb-scratch-clear',
          'aria-label': 'Bersihkan transcript yang terlihat',
          title: 'Bersihkan transcript yang terlihat. Riwayat Ctrl+\u2191 tidak ikut terhapus.',
          disabled: scratchEntries.length === 0,
          onClick: () => this.handleClearTranscript(),
        }, 'clear'),
      ]),
      scratchEntries.length > 0 && h('div', {
        class: 'nb-scratch-history',
        'data-testid': 'nb-scratch-history',
        ref: (node: HTMLElement | null) => {
          this.scratchHistoryEl = node;
        },
        onScroll: (e: Event) => {
          const el = e.currentTarget as HTMLElement;
          this.scratchPinnedToBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        },
      },
        scratchEntries.map((entry, idx) =>
          h('div', { class: 'nb-scratch-entry', key: entry.id, 'data-testid': 'nb-scratch-entry' }, [
            h('div', { class: 'nb-scratch-row' }, [
              h('span', { class: 'nb-scratch-prompt' }, '>'),
              h('div', { class: 'nb-scratch-history-input' }, entry.input),
              entry.host && h('span', {
                class: 'nb-scratch-entry-host',
                'data-testid': 'nb-scratch-entry-host',
              }, entry.host),
            ]),
            h('div', {
              class: `nb-scratch-out ${entry.isError ? 'nb-output-error' : ''}`,
              'data-testid': idx === scratchEntries.length - 1 ? 'nb-scratch-output' : undefined,
            }, entry.output),
          ])
        )
      ),
      h('div', { class: 'nb-scratch-row' }, [
        h('span', { class: 'nb-scratch-prompt' }, '>'),
        h('textarea', {
          class: 'nb-scratch-input',
          'data-testid': 'nb-scratch-input',
          value: scratchInput,
          placeholder: empty ? 'ketik JavaScript, Ctrl+Enter untuk jalan' : '',
          disabled: scratchRunning || !!this.state.runningStepId || this.state.isRunningAll,
          title: (scratchRunning || !!this.state.runningStepId || this.state.isRunningAll) ? CELL_BUSY_REASON : undefined,
          rows: 3,
          ref: (node: HTMLTextAreaElement | null) => {
            this.scratchInputEl = node;
          },
          onInput: (e: Event) => {
            const t = e.target as HTMLTextAreaElement;
            t.style.height = 'auto';
            t.style.height = `${t.scrollHeight}px`;
            this.setState({ scratchInput: t.value });
          },
          onKeyDown: (e: KeyboardEvent) => {
            const t = e.target as HTMLTextAreaElement;
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              this.scratchTabExitArmed = false;
              this.handleScratchRun(t.value);
              t.style.height = 'auto';
              return;
            }
            if (e.key === 'Enter') {
              e.preventDefault();
              this.scratchTabExitArmed = false;
              const start = t.selectionStart;
              const end = t.selectionEnd;
              const before = t.value.slice(0, start);
              const after = t.value.slice(end);
              const lineStart = before.lastIndexOf('\n') + 1;
              const currentLine = before.slice(lineStart);
              const indentMatch = currentLine.match(/^[ \t]*/);
              const indent = indentMatch ? indentMatch[0] : '';
              const trimmed = currentLine.replace(/\s+$/, '');
              const extra = /[{([]$/.test(trimmed) ? '  ' : '';
              const insert = '\n' + indent + extra;
              const next = before + insert + after;
              t.value = next;
              t.selectionStart = t.selectionEnd = start + insert.length;
              t.style.height = 'auto';
              t.style.height = `${t.scrollHeight}px`;
              this.setState({ scratchInput: next });
              return;
            }
            if (e.key === 'Tab' && !e.ctrlKey && !e.altKey) {
              if (this.scratchTabExitArmed) {
                this.scratchTabExitArmed = false;
                e.preventDefault();
                const root = t.closest('.nb-panel') || document;
                const list = Array.from(root.querySelectorAll('button, input, textarea, [tabindex]:not([tabindex="-1"])'))
                  .filter((el) => {
                    const node = el as HTMLElement;
                    return !node.hasAttribute('disabled') && node.tabIndex >= 0;
                  });
                const idx = list.indexOf(t);
                const next = list[idx + 1] || list.find((el) => el !== t);
                if (next) (next as HTMLElement).focus();
                else t.blur();
                return;
              }
              e.preventDefault();
              const start = t.selectionStart;
              const end = t.selectionEnd;
              const next = t.value.slice(0, start) + '  ' + t.value.slice(end);
              t.value = next;
              t.selectionStart = t.selectionEnd = start + 2;
              t.style.height = 'auto';
              t.style.height = `${t.scrollHeight}px`;
              this.setState({ scratchInput: next });
              return;
            }
            if (e.key === 'Escape') {
              this.scratchTabExitArmed = true;
              e.stopPropagation();
              return;
            }
            if (e.key === '}' && !e.ctrlKey && !e.metaKey && !e.altKey) {
              const start = t.selectionStart;
              const before = t.value.slice(0, start);
              const lineStart = before.lastIndexOf('\n') + 1;
              const lineBefore = before.slice(lineStart);
              if (/^[ \t]+$/.test(lineBefore)) {
                e.preventDefault();
                this.scratchTabExitArmed = false;
                let reduced = lineBefore;
                if (reduced.endsWith('  ')) reduced = reduced.slice(0, -2);
                else if (reduced.endsWith('\t')) reduced = reduced.slice(0, -1);
                else reduced = reduced.replace(/[ \t]$/, '');
                const next = t.value.slice(0, lineStart) + reduced + '}' + t.value.slice(t.selectionEnd);
                t.value = next;
                t.selectionStart = t.selectionEnd = lineStart + reduced.length + 1;
                t.style.height = 'auto';
                t.style.height = `${t.scrollHeight}px`;
                this.setState({ scratchInput: next });
                return;
              }
            }
            if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              this.scratchTabExitArmed = false;
              this.navigateScratchHistory(e.key === 'ArrowUp' ? 'up' : 'down', t);
              return;
            }
            this.scratchTabExitArmed = false;
          },
        }),
      ]),
      h('div', { class: 'nb-scratch-save-row', 'data-testid': 'nb-scratch-save-row' }, [
        h('span', { class: 'nb-scratch-save-label' }, 'step:'),
        h('input', {
          class: 'nb-input-step-name',
          'data-testid': 'nb-input-step-name',
          placeholder: 'nama step baru...',
          value: this.state.newStepName,
          disabled: this.state.isSavingStep,
          onInput: (e: Event) => this.setState({ newStepName: (e.target as HTMLInputElement).value }),
          onKeyDown: (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              this.handleSaveScratchAsStep();
            }
          },
        }),
        h('button', {
          class: 'nb-btn-save-scratch-step',
          'data-testid': 'nb-btn-save-scratch-step',
          disabled: this.state.isSavingStep || !scratchInput.trim() || !!this.state.notebookError,
          title: this.state.notebookError ? 'Notebook rusak \u2014 perbaiki notebook terlebih dahulu sebelum menyimpan step' : undefined,
          onClick: () => this.handleSaveScratchAsStep(),
        }, this.state.isSavingStep ? 'menyimpan...' : 'simpan jadi step'),
      ]),
      this.state.saveStepError && h('div', {
        class: 'nb-save-step-error',
        'data-testid': 'nb-save-step-error',
      }, this.state.saveStepError),
      h('div', { class: 'nb-scratch-hint' }, [
        'Enter baris baru \u00b7 ',
        h('span', { class: 'nb-scratch-hint-key' }, 'Ctrl+Enter'),
        ' jalankan',
      ]),
    ]);
  }

  private async handlePick() {
    if (this.state.pointing) return;
    this.setState({ pointing: true });
    const g = (typeof window !== 'undefined' ? window : globalThis) as Record<string, unknown>;
    const kernelService = g.__nbKernelService as {
      runCell: (
        cell: { id: string; name: string; source: string },
        options?: Record<string, unknown>
      ) => Promise<{ ok: boolean; result?: unknown; output?: string; error?: unknown }>;
    } | undefined;
    try {
      if (!kernelService) {
        g.__nbLastPickerResult = {
          cancelled: true,
          reason: 'kernel-missing',
        };
        return;
      }
      const res = await kernelService.runCell(
        { id: '__picker__', name: 'picker', source: getPickerCellSource() },
        {
          ...(this.props.tabId !== undefined ? { tabId: this.props.tabId } : {}),
          skipHud: true,
        }
      );
      const payload = (res.result ?? res) as {
        cancelled?: boolean;
        pickCall?: string;
        unreachable?: { message?: string };
        candidates?: SelectorCandidate[];
        plurals?: PluralSelector[];
      };
      g.__nbLastPickerResult = payload;
      if (payload && payload.unreachable && payload.unreachable.message) {
        const entry: ScratchEntry = {
          id: `picker-${Date.now()}`,
          input: 'pick',
          output: payload.unreachable.message,
          isError: true,
        };
        this.setState((prev) => ({
          scratchEntries: [...prev.scratchEntries, entry].slice(-50),
          helpOpen: true,
          drawerMode: 'results',
        }));
        return;
      }
      if (payload && payload.pickCall) {
        this.setState({
          scratchInput: payload.pickCall || '',
          pickerCandidates: payload.candidates || [],
          pickerPlurals: payload.plurals || [],
          helpOpen: true,
          drawerMode: 'results',
        });
      }
    } finally {
      this.setState({ pointing: false });
    }
  }

  private async handleSearch() {
    const live = typeof document !== 'undefined'
      ? (document.querySelector('[data-testid="nb-picker-search-input"]') as HTMLInputElement | null)?.value
      : '';
    const query = (live || this.state.searchQuery || '').trim();
    const g = (typeof window !== 'undefined' ? window : globalThis) as Record<string, unknown>;
    const kernelService = g.__nbKernelService as {
      runCell: (
        cell: { id: string; name: string; source: string },
        options?: Record<string, unknown>
      ) => Promise<{ ok: boolean; result?: unknown; output?: string; error?: unknown }>;
    } | undefined;
    if (!kernelService) {
      const entry: ScratchEntry = {
        id: `search-${Date.now()}`,
        input: `cari ${query}`,
        output: 'Kernel tidak tersedia.',
        isError: true,
      };
      this.setState((prev) => ({
        scratchEntries: [...prev.scratchEntries, entry].slice(-50),
      }));
      return;
    }
    const res = await kernelService.runCell(
      { id: '__picker-search__', name: 'picker-search', source: getSearchCellSource(query) },
      {
        ...(this.props.tabId !== undefined ? { tabId: this.props.tabId } : {}),
        skipHud: true,
      }
    );
    const payload = (res.result ?? {}) as {
      empty?: boolean;
      message?: string;
      matches?: Array<{ pickCall?: string; text?: string; tagName?: string }>;
      count?: number;
    };
    g.__nbLastSearchResult = payload;
    if (payload.empty) {
      const msg = payload.message || 'Tidak ada elemen yang memuat teks itu.';
      const entry: ScratchEntry = {
        id: `search-${Date.now()}`,
        input: `cari ${query}`,
        output: msg,
        isError: false,
      };
      this.setState((prev) => ({
        scratchEntries: [...prev.scratchEntries, entry].slice(-50),
      }));
      return;
    }
    const lines = (payload.matches || []).map((m) => m.pickCall || `${m.tagName} ${m.text}`).join('\n');
    const first = payload.matches && payload.matches[0] && payload.matches[0].pickCall;
    const entry: ScratchEntry = {
      id: `search-${Date.now()}`,
      input: `cari ${query}`,
      output: lines,
      isError: false,
    };
    this.setState((prev) => ({
      scratchInput: first || prev.scratchInput,
      scratchEntries: [...prev.scratchEntries, entry].slice(-50),
    }));
  }

  private handleClearTranscript() {
    this.scratchHistoryEl = null;
    this.scratchPinnedToBottom = true;
    this.setState({ scratchEntries: [] });
  }

  private clearStopWatchdog() {
    if (this.stopWatchdog !== null) {
      clearTimeout(this.stopWatchdog);
      this.stopWatchdog = null;
    }
  }

  private kernelHandle(): KernelServiceHandle | undefined {
    const g = (typeof window !== 'undefined' ? window : globalThis) as Record<string, unknown>;
    return g.__nbKernelService as KernelServiceHandle | undefined;
  }

  private async handleStop() {
    const cellBusy = this.state.scratchRunning || !!this.state.runningStepId || this.state.isRunningAll;
    if (!cellBusy) return;
    this.stopRequested = true;
    const tabId = this.state.scratchRunning ? this.scratchRunTabId : this.stepRunTabId;
    const targetTab = tabId ?? this.props.tabId;
    const kernelService = this.kernelHandle();
    if (targetTab !== undefined && kernelService?.cancelCell) {
      try {
        await kernelService.cancelCell(targetTab);
      } catch {}
    }
    const epoch = ++this.stopEpoch;
    this.clearStopWatchdog();
    this.stopWatchdog = setTimeout(() => {
      if (epoch !== this.stopEpoch) return;
      if (!this.state.scratchRunning && !this.state.runningStepId && !this.state.isRunningAll) return;
      const entry: ScratchEntry = {
        id: `stop-stall-${Date.now()}`,
        input: 'stop',
        output: STOP_STALL_MESSAGE,
        isError: true,
      };
      this.setState((prev) => ({
        scratchEntries: [...prev.scratchEntries, entry].slice(-50),
      }));
    }, STOP_STALL_MS);
  }

  private async handleScratchRun(fromInput?: string) {
    const raw = fromInput ?? this.state.scratchInput;
    const source = raw.trim();
    if (!source) return;

    // Update history (capped at 50, OQ-1)
    const newHistory = [...this.state.scratchHistory];
    if (newHistory[newHistory.length - 1] !== source) {
      newHistory.push(source);
      if (newHistory.length > 50) newHistory.shift();
      saveScratchHistory(newHistory);
    }

    this.stopRequested = false;
    this.scratchRunTabId = this.props.tabId;
    this.scratchRunHost = this.props.currentSite || this.state.currentSite || '';

    // Input is cleared immediately upon run (D-3)
    this.setState({
      scratchInput: '',
      scratchHistory: newHistory,
      scratchHistoryIndex: -1,
      scratchDraftInput: '',
      scratchRunning: true,
    });

    try {
      const kernelService = this.kernelHandle();
      if (!kernelService) {
        const errorOut = '✖ KernelUnavailableError: Kernel service tidak tersedia.\n  Sebab: Instance __nbKernelService tidak ditemukan.\n  Tindakan: Buka kembali side panel atau muat ulang ekstensi.';
        const entry: ScratchEntry = {
          id: `scratch-${Date.now()}`,
          input: source,
          output: errorOut,
          isError: true,
          host: this.scratchRunHost || undefined,
          tabId: this.scratchRunTabId,
        };
        this.setState((prev) => ({
          scratchEntries: [...prev.scratchEntries, entry],
        }));
        return;
      }
      const res = await kernelService.runCell(
        { id: '__scratch__', name: 'scratch', source },
        this.scratchRunTabId !== undefined ? { tabId: this.scratchRunTabId } : undefined
      );

      const formatted = formatScratchResult(res);
      const entry: ScratchEntry = {
        id: `scratch-${Date.now()}`,
        input: source,
        output: formatted.text,
        isError: formatted.isError,
        host: this.scratchRunHost || undefined,
        tabId: this.scratchRunTabId,
      };

      this.setState((prev) => ({
        scratchEntries: [...prev.scratchEntries, entry],
      }));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const errorOut = `✖ ExecutionError: ${msg}\n  Sebab: Gagal mengeksekusi perintah scratch.\n  Tindakan: Periksa sintaks JavaScript.`;
      const entry: ScratchEntry = {
        id: `scratch-${Date.now()}`,
        input: source,
        output: errorOut,
        isError: true,
        host: this.scratchRunHost || undefined,
        tabId: this.scratchRunTabId,
      };
      this.setState((prev) => ({
        scratchEntries: [...prev.scratchEntries, entry],
      }));
    } finally {
      this.stopEpoch += 1;
      this.clearStopWatchdog();
      this.setState({ scratchRunning: false });
    }
  }

  private toggleCollapsed(stepId: string) {
    this.setState((prev) => ({
      collapsedStepIds: {
        ...prev.collapsedStepIds,
        [stepId]: !prev.collapsedStepIds[stepId],
      },
    }));
  }

  private async handleRunStep(stepId: string) {
    if (this.stopRequested) return;
    this.stepRunTabId = this.props.tabId;
    this.scratchRunHost = this.props.currentSite || this.state.currentSite || '';
    this.setState((prev) => {
      const collapsedStepIds = { ...prev.collapsedStepIds };
      if (this.runAllActive) {
        for (const s of prev.steps) {
          if (s.id !== stepId && s.status === 'ok') {
            collapsedStepIds[s.id] = true;
          }
        }
      }
      return { runningStepId: stepId, collapsedStepIds };
    });
    const started = Date.now();
    try {
      if (this.props.onRunStep) {
        await this.props.onRunStep(stepId);
        return;
      }

      const g = (typeof window !== 'undefined' ? window : globalThis) as Record<string, unknown>;
      const kernelService = g.__nbKernelService as {
        runCell: (
          cell: { id: string; name: string; source: string },
          options?: Record<string, unknown>
        ) => Promise<{ ok: boolean; aborted?: boolean; result?: unknown; output?: string; error?: unknown; candidateIndex?: number; candidateMatch?: { candidateIndex: number; candidate: string; candidates: string[] } }>;
      } | undefined;

      const currentSteps = this.state.steps;
      const targetStep = currentSteps.find(s => s.id === stepId);

      if (!kernelService) {
        const errorMsg = '✖ KernelUnavailableError: Kernel service tidak tersedia di konteks side panel.\n  Sebab: Instance __nbKernelService tidak ditemukan pada konteks eksekusi.\n  Tindakan: Buka kembali side panel atau muat ulang ekstensi.';
        const updatedSteps = currentSteps.map(s => {
          if (s.id !== stepId) return s;
          return {
            ...s,
            status: 'error' as const,
            output: errorMsg,
            error: 'Kernel service unavailable',
          };
        });
        this.setState({ steps: updatedSteps });
        return;
      }

      if (!targetStep) {
        const errorMsg = `✖ StepNotFoundError: Step '${stepId}' tidak ditemukan di notebook.\n  Sebab: Definisi step telah dihapus atau tidak terdaftar.\n  Tindakan: Periksa konfigurasi steps di notebook.md.`;
        const updatedSteps = currentSteps.map(s => {
          if (s.id !== stepId) return s;
          return {
            ...s,
            status: 'error' as const,
            output: errorMsg,
            error: `Step '${stepId}' not found`,
          };
        });
        this.setState({ steps: updatedSteps });
        return;
      }

      let cellToRun: { id: string; name: string; source: string; world?: 'MAIN' | 'USER_SCRIPT'; lineMap?: unknown } = {
        id: targetStep.id,
        name: targetStep.name,
        source: targetStep.source,
      };

      const store = this.props.projectStore;
      if (store) {
        try {
          const hasNb = await store.exists('notebook.md');
          if (hasNb) {
            const md = await store.readFile('notebook.md');
            const { cells } = await loadNotebookCells(md, store);
            const matched = cells.find((c) => c.id === stepId);
            if (matched) {
              cellToRun = {
                ...matched,
                name: matched.name || targetStep.name || targetStep.id,
              };
            } else if (await store.exists(targetStep.id)) {
              const linker = new NotebookModuleLinker(store);
              const linkRes = await linker.link(targetStep.id);
              cellToRun = {
                id: targetStep.id,
                name: targetStep.name,
                source: linkRes.source,
                lineMap: linkRes.lineMap,
              };
            }
          }
        } catch (linkErr: unknown) {
          const msg = linkErr instanceof Error ? linkErr.message : String(linkErr);
          const durationMs = Date.now() - started;
          const updatedSteps = currentSteps.map((s) => {
            if (s.id !== stepId) return s;
            return {
              ...s,
              status: 'error' as const,
              output: `\u2716 LinkError: ${msg}\n  Sebab: Gagal menautkan modul atau berkas impor tidak ditemukan.\n  Tindakan: Periksa path import pada step atau pastikan berkas dependensi ada.`,
              error: msg,
              durationMs,
            };
          });
          this.setState({ steps: updatedSteps });
          return;
        }
      }

      const res = await kernelService.runCell(
        cellToRun,
        this.props.tabId !== undefined ? { tabId: this.props.tabId } : undefined
      );

      const durationMs = Date.now() - started;
      const warning = warningFromResult(res);
      const updatedSteps = currentSteps.map(s => {
        if (s.id !== stepId) return s;
        if (res.aborted) {
          return {
            ...s,
            status: 'skipped' as const,
            output: typeof res.output === 'string' && res.output.trim() !== '' ? res.output : '■ stopped',
            error: undefined,
            durationMs,
          };
        }
        if (res.ok) {
          const signal = evaluateCellOutcome(res.result);
          const skipped = signal.status === 'skipped';
          return {
            ...s,
            status: skipped ? 'skipped' as const : 'ok' as const,
            output: skipped
              ? (signal.reason || (typeof res.result === 'string' ? res.result : (res.output || String(res.result))))
              : (typeof res.result === 'string' ? res.result : (res.output || String(res.result))),
            error: undefined,
            durationMs,
            candidateIndex: res.candidateIndex,
            candidates: res.candidateMatch?.candidates,
            warning,
          };
        } else {
          return {
            ...s,
            status: 'error' as const,
            output: res.output || `✖ ExecutionError: ${String(res.error || 'Execution failed')}\n  Sebab: Eksekusi step mengembalikan status kegagalan.\n  Tindakan: Periksa implementasi step atau dependensi modul.`,
            error: String(res.error || 'Execution failed'),
            durationMs,
          };
        }
      });

      this.setState({ steps: updatedSteps });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const updatedSteps = this.state.steps.map(s => {
        if (s.id !== stepId) return s;
        return {
          ...s,
          status: 'error' as const,
          output: `✖ ExecutionError: ${msg}\n  Sebab: Terjadi kesalahan saat mengeksekusi step.\n  Tindakan: Periksa log konsol browser untuk rincian kesalahan.`,
          error: msg,
        };
      });
      this.setState({ steps: updatedSteps });
    } finally {
      this.stopEpoch += 1;
      this.clearStopWatchdog();
      this.setState({ runningStepId: null });
    }
  }

  private async handleRunAll() {
    this.stopRequested = false;
    this.runAllActive = true;
    this.setState({ isRunningAll: true });
    try {
      if (this.props.onRunAll) {
        await this.props.onRunAll();
        return;
      }

      const currentSteps = this.state.steps;
      const enabledSteps = currentSteps.filter(s => s.enabled);
      for (const step of enabledSteps) {
        if (this.stopRequested) break;
        await this.handleRunStep(step.id);
        const latest = this.state.steps.find(s => s.id === step.id);
        if (latest?.status === 'error') break;
        if (this.stopRequested) break;
      }
    } finally {
      this.runAllActive = false;
      this.setState({ isRunningAll: false });
    }
  }
}

export function createStepsFromNotebook(parsed: { allSteps: Array<{ path: string; name?: string; enabled?: boolean }> }): StepItem[] {
  return parsed.allSteps.map((step, idx) => ({
    id: step.path,
    name: step.name || step.path,
    source: step.path,
    enabled: step.enabled !== false,
    order: idx + 1,
  }));
}

export function mountSidePanel(container: HTMLElement, props: SidePanelProps = {}): void {
  render(h(SidePanelApp, props), container);
}
