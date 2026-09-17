import { describe, it, expect } from 'vitest';
import { TOKENS, generateTokenStyles, generateTokenCssVars, generateExtensionPageResets } from './tokens';

function oklchParts(value: string): { l: number; c: number; h: number } {
  const m = value.match(/^oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)$/);
  if (!m) {
    throw new Error(`not oklch: ${value}`);
  }
  return { l: Number(m[1]), c: Number(m[2]), h: Number(m[3]) };
}

describe('Design Tokens', () => {
  it('enforces corner radius of 0', () => {
    for (const [_key, radius] of Object.entries(TOKENS.radii)) {
      expect(radius).toBe('0px');
    }
  });

  it('enforces exactly two font families: sans and mono', () => {
    const fontKeys = Object.keys(TOKENS.fonts);
    expect(fontKeys).toEqual(['sans', 'mono']);
  });

  it('uses JetBrains Mono at 12px / 1.7', () => {
    expect(TOKENS.fonts.mono).toContain('JetBrains Mono');
    expect(TOKENS.fontSizes.base).toBe('12px');
    expect(TOKENS.lineHeights.normal).toBe('1.7');
  });

  it('uses oklch colors from the locked mockup', () => {
    for (const [_key, color] of Object.entries(TOKENS.colors)) {
      expect(color).toMatch(/^oklch\([\d.]+ [\d.]+ [\d.]+\)$/);
    }
    expect(TOKENS.colors.bg).toBe('oklch(0.19 0.008 265)');
    expect(TOKENS.colors.text).toBe('oklch(0.90 0.012 265)');
  });

  it('keeps dim text lightness at or above 0.58', () => {
    const dimKeys = ['textMuted', 'textSubtle', 'textInactive', 'textFooter', 'textLabel', 'disabled'] as const;
    for (const key of dimKeys) {
      expect(oklchParts(TOKENS.colors[key]).l).toBeGreaterThanOrEqual(0.58);
    }
  });

  it('keeps prompt teal (195) and distinct from warning amber (85)', () => {
    expect(oklchParts(TOKENS.colors.prompt).h).toBe(195);
    expect(oklchParts(TOKENS.colors.accent).h).toBe(195);
    expect(oklchParts(TOKENS.colors.warning).h).toBe(85);
    expect(TOKENS.colors.prompt).not.toBe(TOKENS.colors.warning);
  });

  it('keeps four meaning hues: teal 195, green 150, amber 85, red 22', () => {
    expect(oklchParts(TOKENS.colors.prompt).h).toBe(195);
    expect(oklchParts(TOKENS.colors.success).h).toBe(150);
    expect(oklchParts(TOKENS.colors.warning).h).toBe(85);
    expect(oklchParts(TOKENS.colors.error).h).toBe(22);
  });

  it('keeps generateTokenCssVars separate from page resets', () => {
    const vars = generateTokenCssVars();
    const resets = generateExtensionPageResets();
    expect(vars).toContain('--nb-color-bg:');
    expect(vars).toContain('--nb-color-prompt:');
    expect(vars).not.toContain('body, html');
    expect(resets).toContain('body, html');
    expect(resets).toContain('var(--nb-font-mono)');
  });

  it('generates stylesheet with CSS variables for all tokens', () => {
    const css = generateTokenStyles();
    expect(css).toContain('--nb-color-bg:');
    expect(css).toContain('--nb-color-accent:');
    expect(css).toContain('--nb-font-sans:');
    expect(css).toContain('--nb-font-mono:');
    expect(css).toContain('--nb-radius-base: 0px');
  });
});
