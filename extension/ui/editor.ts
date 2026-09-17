/**
 * extension/ui/editor.ts
 * Minimal full-tab code editor (RQ-12, D-4).
 *
 * Rules:
 * - Separate full tab (not in-panel, not in-page).
 * - Edits one file from ProjectStore, Save button, Run button.
 * - Minimal, quiet typography, zero IDE bloat (D-4).
 */

import { h, Component, render } from 'preact';
import { generateTokenStyles } from './tokens';
import type { ProjectStore } from '../platform/interface';

export interface EditorProps {
  filePath: string;
  initialContent?: string;
  projectStore?: ProjectStore;
  tabId?: number;
  onSave?: (filePath: string, content: string) => Promise<void>;
  onRun?: (filePath: string, content: string) => Promise<{ ok: boolean; output?: string; result?: unknown }>;
}

export interface EditorState {
  filePath: string;
  content: string;
  isDirty: boolean;
  isSaving: boolean;
  isRunning: boolean;
  saveStatus: string | null;
  output: string | null;
  outputStatus: 'ok' | 'error' | null;
}

export function injectEditorStyles(): void {
  if (typeof document !== 'undefined' && !document.getElementById('nb-editor-styles')) {
    const style = document.createElement('style');
    style.id = 'nb-editor-styles';
    style.textContent = generateTokenStyles() + `
      .nb-editor-page {
        display: flex;
        flex-direction: column;
        height: 100vh;
        width: 100vw;
        background: var(--nb-color-bg);
        color: var(--nb-color-text);
        box-sizing: border-box;
      }
      .nb-editor-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--nb-spacing-sm) var(--nb-spacing-md);
        background: var(--nb-color-surface);
        border-bottom: var(--nb-border-thin);
      }
      .nb-editor-file-info {
        display: flex;
        align-items: center;
        gap: var(--nb-spacing-sm);
      }
      .nb-editor-path {
        font-family: var(--nb-font-mono);
        font-size: var(--nb-font-size-sm);
        font-weight: 600;
      }
      .nb-editor-dirty-dot {
        font-size: var(--nb-font-size-xs);
        color: var(--nb-color-warning);
      }
      .nb-editor-actions {
        display: flex;
        align-items: center;
        gap: var(--nb-spacing-xs);
      }
      .nb-editor-status {
        font-size: var(--nb-font-size-xs);
        color: var(--nb-color-text-muted);
        margin-right: var(--nb-spacing-xs);
      }
      .nb-editor-main {
        flex: 1;
        display: flex;
        flex-direction: column;
        padding: var(--nb-spacing-md);
        gap: var(--nb-spacing-sm);
        overflow: hidden;
      }
      .nb-editor-textarea {
        flex: 1;
        width: 100%;
        background: var(--nb-color-bg);
        color: var(--nb-color-text);
        font-family: var(--nb-font-mono);
        font-size: var(--nb-font-size-sm);
        line-height: var(--nb-line-height-normal);
        border: var(--nb-border-thin);
        border-radius: var(--nb-radius-sm);
        padding: var(--nb-spacing-sm);
        resize: none;
        outline: none;
        box-sizing: border-box;
      }
      .nb-editor-textarea:focus {
        border-color: var(--nb-color-accent);
      }
      .nb-editor-output-pane {
        max-height: 160px;
        overflow-y: auto;
        padding: var(--nb-spacing-sm);
        background: var(--nb-color-surface);
        border: var(--nb-border-thin);
        border-radius: var(--nb-radius-sm);
        font-family: var(--nb-font-mono);
        font-size: var(--nb-font-size-xs);
        white-space: pre-wrap;
        word-break: break-all;
      }
      .nb-editor-output-ok {
        border-color: var(--nb-color-success);
        color: var(--nb-color-success);
      }
      .nb-editor-output-error {
        border-color: var(--nb-color-error);
        color: var(--nb-color-error);
      }
    `;
    document.head.appendChild(style);
  }
}

export class EditorApp extends Component<EditorProps, EditorState> {
  constructor(props: EditorProps) {
    super(props);
    this.state = {
      filePath: props.filePath || '',
      content: props.initialContent || '',
      isDirty: false,
      isSaving: false,
      isRunning: false,
      saveStatus: null,
      output: null,
      outputStatus: null,
    };
  }

  override setState<K extends keyof EditorState>(
    state: ((prevState: Readonly<EditorState>, props: Readonly<EditorProps>) => Pick<EditorState, K> | EditorState | null) | (Pick<EditorState, K> | EditorState | null),
    callback?: () => void
  ): void {
    if (typeof state === 'function') {
      const next = state(this.state, this.props);
      if (next) this.state = { ...this.state, ...next };
    } else if (state) {
      this.state = { ...this.state, ...state };
    }
    super.setState(state, callback);
  }

  componentDidMount() {
    injectEditorStyles();
    this.loadFileContent();
  }

  componentWillReceiveProps(nextProps: EditorProps) {
    if (nextProps.filePath !== this.props.filePath || nextProps.initialContent !== this.props.initialContent) {
      this.setState({
        filePath: nextProps.filePath || '',
        content: nextProps.initialContent || '',
        isDirty: false,
        saveStatus: null,
        output: null,
        outputStatus: null,
      });
    }
  }

  async loadFileContent() {
    if (this.props.projectStore && this.state.filePath && !this.props.initialContent) {
      try {
        const text = await this.props.projectStore.readFile(this.state.filePath);
        this.setState({ content: text, isDirty: false });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.setState({
          content: `// Berkas '${this.state.filePath}' tidak ditemukan.\n// Sebab: ${msg}\n`,
          isDirty: false,
        });
      }
    }
  }

  async handleSave() {
    this.setState({ isSaving: true, saveStatus: 'Menyimpan...' });
    try {
      if (this.props.onSave) {
        await this.props.onSave(this.state.filePath, this.state.content);
      } else if (this.props.projectStore) {
        await this.props.projectStore.writeFile(this.state.filePath, this.state.content);
      } else {
        throw new Error('Tidak ada tujuan penulisan: onSave atau projectStore tidak tersedia');
      }
      this.setState({ isDirty: false, saveStatus: 'Tersimpan' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setState({ saveStatus: `Gagal simpan: ${msg}` });
      throw err;
    } finally {
      this.setState({ isSaving: false });
    }
  }

  async handleRun() {
    this.setState({ isRunning: true, output: 'Menjalankan...', outputStatus: null });
    try {
      if (this.props.onRun) {
        const res = await this.props.onRun(this.state.filePath, this.state.content);
        this.setState({
          output: res.output || (typeof res.result === 'string' ? res.result : JSON.stringify(res.result)),
          outputStatus: res.ok ? 'ok' : 'error',
        });
        return;
      }

      // Default execution via global kernel service
      const g = (typeof window !== 'undefined' ? window : globalThis) as Record<string, unknown>;
      const kernelService = g.__nbKernelService as {
        runCell: (
          cell: { id: string; name: string; source: string },
          options?: Record<string, unknown>
        ) => Promise<{ ok: boolean; result?: unknown; output?: string; error?: unknown }>;
      } | undefined;

      if (!kernelService) {
        this.setState({ output: 'Kernel service tidak tersedia', outputStatus: 'error' });
        return;
      }

      const res = await kernelService.runCell(
        {
          id: this.state.filePath,
          name: this.state.filePath,
          source: this.state.content,
        },
        this.props.tabId !== undefined ? { tabId: this.props.tabId } : undefined
      );

      this.setState({
        output: res.ok
          ? (typeof res.result === 'string' ? res.result : (res.output || String(res.result)))
          : (res.output || String(res.error || 'Execution failed')),
        outputStatus: res.ok ? 'ok' : 'error',
      });
    } catch (err) {
      this.setState({ output: String(err), outputStatus: 'error' });
    } finally {
      this.setState({ isRunning: false });
    }
  }

  render() {
    const { filePath, content, isDirty, isSaving, isRunning, saveStatus, output, outputStatus } = this.state;
    const canSave = Boolean(this.props.onSave || this.props.projectStore);

    return h('div', { class: 'nb-editor-page', 'data-testid': 'nb-editor-root' }, [
      // Header
      h('header', { class: 'nb-editor-header' }, [
        h('div', { class: 'nb-editor-file-info' }, [
          h('span', { class: 'nb-editor-path', 'data-testid': 'nb-editor-filepath' }, filePath),
          isDirty && h('span', { class: 'nb-editor-dirty-dot', 'data-testid': 'nb-editor-dirty' }, '● (unsaved)'),
        ]),
        h('div', { class: 'nb-editor-actions' }, [
          saveStatus && h('span', { class: 'nb-editor-status', 'data-testid': 'nb-editor-save-status' }, saveStatus),
          h('button', {
            'data-testid': 'nb-editor-btn-save',
            disabled: isSaving || !isDirty || !canSave,
            onClick: () => this.handleSave().catch(() => {}),
            'aria-label': 'Simpan berkas',
          }, isSaving ? 'Menyimpan...' : 'Simpan'),
          h('button', {
            'data-testid': 'nb-editor-btn-run',
            disabled: isRunning,
            onClick: () => this.handleRun(),
            'aria-label': 'Jalankan berkas di tab aktif',
          }, isRunning ? '...' : 'Jalankan'),
        ]),
      ]),

      // Main Textarea
      h('main', { class: 'nb-editor-main' }, [
        h('textarea', {
          class: 'nb-editor-textarea',
          'data-testid': 'nb-editor-textarea',
          value: content,
          'aria-label': `Editor kode untuk ${filePath}`,
          onInput: (e: Event) => {
            const target = e.target as HTMLTextAreaElement;
            this.setState({ content: target.value, isDirty: true });
          },
        }),
        output !== null && h('div', {
          class: `nb-editor-output-pane ${outputStatus === 'ok' ? 'nb-editor-output-ok' : outputStatus === 'error' ? 'nb-editor-output-error' : ''}`,
          'data-testid': 'nb-editor-output',
        }, output),
      ]),
    ]);
  }
}

/**
 * Mount full-tab editor into container DOM element.
 */
export function mountEditor(container: HTMLElement, props: EditorProps): void {
  render(h(EditorApp, props), container);
}
