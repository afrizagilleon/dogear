export const TOKENS = {
  colors: {
    bg: 'oklch(0.19 0.008 265)',
    surface: 'oklch(0.19 0.008 265)',
    surfaceHover: 'oklch(0.19 0.008 265)',
    surfaceActive: 'oklch(0.19 0.008 265)',
    border: 'oklch(0.30 0.012 265)',
    borderSubtle: 'oklch(0.26 0.01 265)',
    borderFocus: 'oklch(0.76 0.11 195)',
    text: 'oklch(0.90 0.012 265)',
    textMuted: 'oklch(0.66 0.015 265)',
    textSubtle: 'oklch(0.58 0.015 265)',
    textStep: 'oklch(0.74 0.014 265)',
    textBody: 'oklch(0.80 0.014 265)',
    textLabel: 'oklch(0.62 0.015 265)',
    textBright: 'oklch(0.84 0.014 265)',
    textFold: 'oklch(0.70 0.015 265)',
    textFooter: 'oklch(0.60 0.015 265)',
    textInactive: 'oklch(0.58 0.012 265)',
    accent: 'oklch(0.76 0.11 195)',
    accentHover: 'oklch(0.84 0.11 195)',
    prompt: 'oklch(0.76 0.11 195)',
    success: 'oklch(0.78 0.13 150)',
    successBg: 'oklch(0.19 0.008 265)',
    error: 'oklch(0.72 0.16 22)',
    errorBg: 'oklch(0.19 0.008 265)',
    errorName: 'oklch(0.80 0.13 22)',
    errorCandidate: 'oklch(0.74 0.05 22)',
    warning: 'oklch(0.82 0.11 85)',
    disabled: 'oklch(0.58 0.012 265)',
    disabledBg: 'oklch(0.19 0.008 265)',
  },
  fonts: {
    sans: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    mono: "'JetBrains Mono', ui-monospace, monospace",
  },
  fontSizes: {
    xs: '10px',
    sm: '11px',
    base: '12px',
    md: '13px',
    lg: '14px',
  },
  lineHeights: {
    tight: '1.2',
    normal: '1.7',
    relaxed: '1.7',
  },
  spacing: {
    none: '0px',
    xxs: '2px',
    xs: '4px',
    sm: '6px',
    md: '8px',
    lg: '12px',
    xl: '16px',
    gap: '7px',
    step: '5px',
    headerTop: '11px',
    headerBottom: '9px',
    contentX: '14px',
    fold: '22px',
    scratch: '20px',
    indent: '20px',
  },
  radii: {
    none: '0px',
    sm: '0px',
    base: '0px',
  },
  borders: {
    thin: '1px solid oklch(0.30 0.012 265)',
    subtle: '1px solid oklch(0.26 0.01 265)',
    focus: '1px solid oklch(0.76 0.11 195)',
    error: '1px solid oklch(0.72 0.16 22)',
  },
} as const;

export type TokenColors = typeof TOKENS.colors;
export type TokenFonts = typeof TOKENS.fonts;

export function generateTokenCssVars(): string {
  return `
:root {
  --nb-color-bg: ${TOKENS.colors.bg};
  --nb-color-surface: ${TOKENS.colors.surface};
  --nb-color-surface-hover: ${TOKENS.colors.surfaceHover};
  --nb-color-surface-active: ${TOKENS.colors.surfaceActive};
  --nb-color-border: ${TOKENS.colors.border};
  --nb-color-border-subtle: ${TOKENS.colors.borderSubtle};
  --nb-color-border-focus: ${TOKENS.colors.borderFocus};
  --nb-color-text: ${TOKENS.colors.text};
  --nb-color-text-muted: ${TOKENS.colors.textMuted};
  --nb-color-text-subtle: ${TOKENS.colors.textSubtle};
  --nb-color-text-step: ${TOKENS.colors.textStep};
  --nb-color-text-body: ${TOKENS.colors.textBody};
  --nb-color-text-label: ${TOKENS.colors.textLabel};
  --nb-color-text-bright: ${TOKENS.colors.textBright};
  --nb-color-text-fold: ${TOKENS.colors.textFold};
  --nb-color-text-footer: ${TOKENS.colors.textFooter};
  --nb-color-text-inactive: ${TOKENS.colors.textInactive};
  --nb-color-accent: ${TOKENS.colors.accent};
  --nb-color-accent-hover: ${TOKENS.colors.accentHover};
  --nb-color-prompt: ${TOKENS.colors.prompt};
  --nb-color-success: ${TOKENS.colors.success};
  --nb-color-success-bg: ${TOKENS.colors.successBg};
  --nb-color-error: ${TOKENS.colors.error};
  --nb-color-error-bg: ${TOKENS.colors.errorBg};
  --nb-color-error-name: ${TOKENS.colors.errorName};
  --nb-color-error-candidate: ${TOKENS.colors.errorCandidate};
  --nb-color-warning: ${TOKENS.colors.warning};
  --nb-color-disabled: ${TOKENS.colors.disabled};
  --nb-color-disabled-bg: ${TOKENS.colors.disabledBg};

  --nb-font-sans: ${TOKENS.fonts.sans};
  --nb-font-mono: ${TOKENS.fonts.mono};

  --nb-font-size-xs: ${TOKENS.fontSizes.xs};
  --nb-font-size-sm: ${TOKENS.fontSizes.sm};
  --nb-font-size-base: ${TOKENS.fontSizes.base};
  --nb-font-size-md: ${TOKENS.fontSizes.md};
  --nb-font-size-lg: ${TOKENS.fontSizes.lg};

  --nb-line-height-tight: ${TOKENS.lineHeights.tight};
  --nb-line-height-normal: ${TOKENS.lineHeights.normal};
  --nb-line-height-relaxed: ${TOKENS.lineHeights.relaxed};

  --nb-spacing-none: ${TOKENS.spacing.none};
  --nb-spacing-xxs: ${TOKENS.spacing.xxs};
  --nb-spacing-xs: ${TOKENS.spacing.xs};
  --nb-spacing-sm: ${TOKENS.spacing.sm};
  --nb-spacing-md: ${TOKENS.spacing.md};
  --nb-spacing-lg: ${TOKENS.spacing.lg};
  --nb-spacing-xl: ${TOKENS.spacing.xl};
  --nb-spacing-gap: ${TOKENS.spacing.gap};
  --nb-spacing-step: ${TOKENS.spacing.step};
  --nb-spacing-header-top: ${TOKENS.spacing.headerTop};
  --nb-spacing-header-bottom: ${TOKENS.spacing.headerBottom};
  --nb-spacing-content-x: ${TOKENS.spacing.contentX};
  --nb-spacing-fold: ${TOKENS.spacing.fold};
  --nb-spacing-scratch: ${TOKENS.spacing.scratch};
  --nb-spacing-indent: ${TOKENS.spacing.indent};

  --nb-radius-none: ${TOKENS.radii.none};
  --nb-radius-sm: ${TOKENS.radii.sm};
  --nb-radius-base: ${TOKENS.radii.base};

  --nb-border-thin: ${TOKENS.borders.thin};
  --nb-border-subtle: ${TOKENS.borders.subtle};
  --nb-border-focus: ${TOKENS.borders.focus};
  --nb-border-error: ${TOKENS.borders.error};
}
`;
}

export function generateExtensionPageResets(): string {
  return `
body, html {
  margin: 0;
  padding: 0;
  height: 100%;
  overflow: hidden;
  background-color: var(--nb-color-bg);
  color: var(--nb-color-text);
  font-family: var(--nb-font-mono);
  font-size: var(--nb-font-size-base);
  line-height: var(--nb-line-height-normal);
  box-sizing: border-box;
  -webkit-font-smoothing: antialiased;
}

*, *:before, *:after {
  box-sizing: inherit;
}

button {
  font-family: var(--nb-font-mono);
  font-size: var(--nb-font-size-base);
  background-color: transparent;
  color: var(--nb-color-text);
  border: var(--nb-border-thin);
  border-radius: var(--nb-radius-none);
  padding: var(--nb-spacing-xxs) var(--nb-spacing-sm);
  cursor: pointer;
  outline: none;
}

button:hover:not(:disabled) {
  color: var(--nb-color-text-bright);
}

button:focus-visible {
  border-color: var(--nb-color-prompt);
}

button:disabled {
  color: var(--nb-color-disabled);
  cursor: not-allowed;
}

code, pre, .nb-mono {
  font-family: var(--nb-font-mono);
  font-size: var(--nb-font-size-base);
}
`;
}

export function generateTokenStyles(): string {
  return generateTokenCssVars() + generateExtensionPageResets();
}
