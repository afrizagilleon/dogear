/**
 * extension/ui/hud.ts
 * In-page HUD status overlay (RQ-05, OQ-2, D-3).
 *
 * Rules:
 * - Only present during/after execution or when triggered (OQ-2: never permanently lingering).
 * - Displays status: idle / running / ok / error, step name, and output.
 * - STRICTLY NO <textarea>, NO contenteditable, NO editor elements (D-3).
 * - Adheres strictly to design tokens (border radius <= 3px, lines not shadows).
 */

import { generateTokenCssVars } from './tokens';

export interface HudState {
  status: 'idle' | 'running' | 'ok' | 'error';
  stepName?: string;
  output?: string;
  visible?: boolean;
}

const HUD_CONTAINER_ID = 'nb-steprunner-hud-root';
const SHARED_TOKEN_STYLE_ID = 'nb-shared-token-vars';

export function injectSharedTokenVars(styleId = SHARED_TOKEN_STYLE_ID): HTMLStyleElement | null {
  if (typeof document === 'undefined') return null;
  let style = document.getElementById(styleId) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = styleId;
    style.textContent = generateTokenCssVars();
    document.head.appendChild(style);
  }
  return style;
}

export function removeSharedTokenVars(styleId = SHARED_TOKEN_STYLE_ID): void {
  if (typeof document === 'undefined') return;
  const style = document.getElementById(styleId);
  if (style) style.remove();
}

export function getHudStyles(): string {
  return generateTokenCssVars() + `
    #${HUD_CONTAINER_ID} {
      position: fixed;
      bottom: var(--nb-spacing-md);
      right: var(--nb-spacing-md);
      z-index: 2147483640;
      font-family: var(--nb-font-sans);
      font-size: var(--nb-font-size-sm);
      color: var(--nb-color-text);
      pointer-events: auto;
      margin: 0;
      padding: 0;
      line-height: var(--nb-line-height-normal);
      -webkit-font-smoothing: antialiased;
    }
    #${HUD_CONTAINER_ID} * {
      box-sizing: border-box;
    }
    #${HUD_CONTAINER_ID} .nb-hud {
      display: flex;
      flex-direction: column;
      gap: var(--nb-spacing-xs);
      min-width: 220px;
      max-width: 360px;
      padding: var(--nb-spacing-sm);
      background: var(--nb-color-surface);
      border: var(--nb-border-thin);
      border-radius: var(--nb-radius-sm);
      box-sizing: border-box;
    }
    #${HUD_CONTAINER_ID} .nb-hud-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--nb-spacing-sm);
    }
    #${HUD_CONTAINER_ID} .nb-hud-title {
      font-weight: 600;
      font-size: var(--nb-font-size-xs);
      letter-spacing: 0.02em;
      text-transform: uppercase;
      color: var(--nb-color-text-muted);
    }
    #${HUD_CONTAINER_ID} .nb-hud-badge {
      font-family: var(--nb-font-mono);
      font-size: var(--nb-font-size-xs);
      padding: 1px var(--nb-spacing-xs);
      border-radius: var(--nb-radius-sm);
      border: var(--nb-border-subtle);
    }
    #${HUD_CONTAINER_ID} .nb-hud-badge-idle {
      color: var(--nb-color-text-muted);
      border-color: var(--nb-color-border-subtle);
    }
    #${HUD_CONTAINER_ID} .nb-hud-badge-running {
      color: var(--nb-color-accent);
      border-color: var(--nb-color-accent);
    }
    #${HUD_CONTAINER_ID} .nb-hud-badge-ok {
      color: var(--nb-color-success);
      border-color: var(--nb-color-success);
    }
    #${HUD_CONTAINER_ID} .nb-hud-badge-error {
      color: var(--nb-color-error);
      border-color: var(--nb-color-error);
    }
    #${HUD_CONTAINER_ID} .nb-hud-step {
      font-family: var(--nb-font-mono);
      font-size: var(--nb-font-size-sm);
      color: var(--nb-color-text);
      word-break: break-all;
    }
    #${HUD_CONTAINER_ID} .nb-hud-output {
      font-family: var(--nb-font-mono);
      font-size: var(--nb-font-size-xs);
      padding: var(--nb-spacing-xs);
      background: var(--nb-color-bg);
      border: var(--nb-border-subtle);
      border-radius: var(--nb-radius-sm);
      max-height: 80px;
      overflow-y: auto;
      white-space: pre-wrap;
      word-break: break-all;
    }
    #${HUD_CONTAINER_ID} .nb-hud-close {
      background: transparent;
      border: none;
      color: var(--nb-color-text-muted);
      cursor: pointer;
      font-family: var(--nb-font-sans);
      font-size: var(--nb-font-size-md);
      line-height: 1;
      padding: 0 var(--nb-spacing-xs);
    }
    #${HUD_CONTAINER_ID} .nb-hud-close:hover {
      color: var(--nb-color-text);
      background: transparent;
    }
  `;
}

/**
 * Render HUD HTML string from state.
 */
export function renderHudHtml(state: HudState): string {
  if (state.visible === false) return '';

  const badgeClass = `nb-hud-badge nb-hud-badge-${state.status}`;
  const stepText = state.stepName ? `<div class="nb-hud-step" data-testid="nb-hud-step">${state.stepName}</div>` : '';
  const outputHtml = state.output !== undefined
    ? `<div class="nb-hud-output" data-testid="nb-hud-output">${state.output}</div>`
    : '';

  return `
    <div class="nb-hud" data-testid="nb-hud-box" data-status="${state.status}">
      <div class="nb-hud-header">
        <span class="nb-hud-title">dogear</span>
        <span class="${badgeClass}" data-testid="nb-hud-status">${state.status}</span>
        <button class="nb-hud-close" aria-label="Tutup HUD" data-testid="nb-hud-btn-close">&times;</button>
      </div>
      ${stepText}
      ${outputHtml}
    </div>
  `;
}

/**
 * Mount or update HUD in current DOM.
 */
export function updateInPageHud(state: HudState): HTMLElement | null {
  if (typeof document === 'undefined') return null;

  let container = document.getElementById(HUD_CONTAINER_ID);

  if (state.visible === false) {
    if (container) container.remove();
    return null;
  }

  if (!container) {
    // Inject style tag if not present
    if (!document.getElementById('nb-hud-style')) {
      const style = document.createElement('style');
      style.id = 'nb-hud-style';
      style.textContent = getHudStyles();
      document.head.appendChild(style);
    }

    container = document.createElement('div');
    container.id = HUD_CONTAINER_ID;
    document.body.appendChild(container);
  }

  container.innerHTML = renderHudHtml(state);

  const closeBtn = container.querySelector('.nb-hud-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      container?.remove();
    });
  }

  return container;
}

/**
 * Mount HUD in current DOM.
 */
export function mountInPageHud(state: HudState): HTMLElement | null {
  return updateInPageHud(state);
}

/**
 * Injected script string containing HUD runtime for in-page execution.
 */
export const INJECTED_HUD_SCRIPT = `
  const HUD_CONTAINER_ID = '${HUD_CONTAINER_ID}';
  const getHudStyles = () => \`${getHudStyles().replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`;
  const renderHudHtml = (state) => {
    if (state.visible === false) return '';
    const badgeClass = 'nb-hud-badge nb-hud-badge-' + state.status;
    const stepText = state.stepName ? '<div class="nb-hud-step" data-testid="nb-hud-step">' + state.stepName + '</div>' : '';
    const outputHtml = state.output !== undefined
      ? '<div class="nb-hud-output" data-testid="nb-hud-output">' + state.output + '</div>'
      : '';
    return '<div class="nb-hud" data-testid="nb-hud-box" data-status="' + state.status + '">' +
      '<div class="nb-hud-header">' +
        '<span class="nb-hud-title">dogear</span>' +
        '<span class="' + badgeClass + '" data-testid="nb-hud-status">' + state.status + '</span>' +
        '<button class="nb-hud-close" aria-label="Tutup HUD" data-testid="nb-hud-btn-close">&times;</button>' +
      '</div>' +
      stepText +
      outputHtml +
    '</div>';
  };
  const updateInPageHud = (state) => {
    if (typeof document === 'undefined') return null;
    let container = document.getElementById(HUD_CONTAINER_ID);
    if (state.visible === false) {
      if (container) container.remove();
      return null;
    }
    if (!container) {
      if (!document.getElementById('nb-hud-style')) {
        const style = document.createElement('style');
        style.id = 'nb-hud-style';
        style.textContent = getHudStyles();
        document.head.appendChild(style);
      }
      container = document.createElement('div');
      container.id = HUD_CONTAINER_ID;
      document.body.appendChild(container);
    }
    container.innerHTML = renderHudHtml(state);
    const closeBtn = container.querySelector('.nb-hud-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => { container?.remove(); });
    }
    return container;
  };
  const mountInPageHud = (state) => updateInPageHud(state);
`;

/**
 * Remove HUD from page.
 */
export function removeInPageHud(): void {
  if (typeof document !== 'undefined') {
    const container = document.getElementById(HUD_CONTAINER_ID);
    if (container) container.remove();
  }
}
