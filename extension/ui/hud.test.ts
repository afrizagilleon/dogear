/**
 * extension/ui/hud.test.ts
 * Unit tests for In-Page HUD component and D-3 constraints (RQ-05, D-3).
 */

import { describe, it, expect } from 'vitest';
import { renderHudHtml, updateInPageHud, removeInPageHud, getHudStyles } from './hud';

describe('In-Page HUD (RQ-05, D-3)', () => {
  it('renders status, step name, and output without editor elements (D-3, RQ-05)', () => {
    const html = renderHudHtml({
      status: 'ok',
      stepName: '1. Initialize Setup',
      output: 'Result: 42',
      visible: true,
    });

    expect(html).toContain('nb-hud-badge-ok');
    expect(html).toContain('ok');
    expect(html).toContain('1. Initialize Setup');
    expect(html).toContain('Result: 42');

    // D-3 Strict Constraint: NO <textarea>, NO contenteditable, NO editor element
    expect(html.toLowerCase()).not.toContain('<textarea');
    expect(html.toLowerCase()).not.toContain('contenteditable');
    expect(html.toLowerCase()).not.toContain('cm-editor');
    expect(html.toLowerCase()).not.toContain('monaco');
  });

  it('renders empty string when visible is false', () => {
    const html = renderHudHtml({
      status: 'idle',
      visible: false,
    });
    expect(html).toBe('');
  });

  it('handles safe execution when document is undefined', () => {
    expect(() => removeInPageHud()).not.toThrow();
    expect(updateInPageHud({ status: 'idle', visible: false })).toBeNull();
  });

  it('generates HUD styles adhering to token constraints (radius <= 3px)', () => {
    const styles = getHudStyles();
    expect(styles).toContain('--nb-color-surface');
    expect(styles).toContain('--nb-radius-sm');
    expect(styles).toContain('--nb-border-thin');
  });
});
