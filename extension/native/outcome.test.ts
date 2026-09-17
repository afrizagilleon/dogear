/**
 * extension/native/outcome.test.ts
 * Tests for the four terminal states and example notebooks (T-02, RQ-02, RQ-03, D-1, D-2, D-3).
 */

import { describe, it, expect } from 'vitest';
import { parseNotebookMarkdown } from '../project/notebook-parser';
import {
  evaluateCellOutcome,
  mapFailureToOutcome,
  mapSignalToOutcome,
} from './outcome';
import {
  NOTEBOOK_COMPLETED,
  NOTEBOOK_SKIPPED,
  NOTEBOOK_NEEDS_REVIEW,
  NOTEBOOK_SESSION_DEAD,
  ALL_EXAMPLE_NOTEBOOKS,
} from './fixtures';
import type { TerminalState } from './types';

describe('T-02: Four Terminal Execution States (RQ-02, RQ-03, D-1, D-2, D-3)', () => {
  it('has all four example notebooks defined with distinct expected states', () => {
    expect(ALL_EXAMPLE_NOTEBOOKS).toHaveLength(4);
    const states = ALL_EXAMPLE_NOTEBOOKS.map((nb) => nb.expectedState);
    expect(states).toEqual(['completed', 'skipped', 'needs_review', 'session_dead']);
  });

  it('1. Completed: parses example notebook and verifies natural completed state', () => {
    const parsed = parseNotebookMarkdown(NOTEBOOK_COMPLETED.markdown);
    expect(parsed.name).toBe('Proses Pesanan Toko');
    expect(parsed.enabledSteps).toHaveLength(2);

    const step1Code = NOTEBOOK_COMPLETED.files['steps/01-ambil-pesanan.js'];
    expect(step1Code).toContain("status: 'completed'");

    // Normal successful step result without explicit status
    const normalResult = { nomorPesanan: 'INV-2026-0901', processed: true };
    const outcome1 = evaluateCellOutcome(normalResult);
    expect(outcome1.status).toBe('completed');
    expect(outcome1.data).toEqual(normalResult);

    // Explicit completed signal
    const explicitSignal = { status: 'completed' as const, data: { statusPemrosesan: 'SUKSES' } };
    const outcome2 = evaluateCellOutcome(explicitSignal);
    expect(outcome2.status).toBe('completed');
    expect(outcome2.data).toEqual({ statusPemrosesan: 'SUKSES' });

    const finalAnswer = mapSignalToOutcome(outcome2, 'steps/02-konfirmasi.js', ['steps/01-ambil-pesanan.js', 'steps/02-konfirmasi.js']);
    expect(finalAnswer.state).toBe('completed');
    expect(finalAnswer.error).toBeUndefined();
  });

  it('2. Skipped: parses example notebook and resolves skipped state with reason', () => {
    const parsed = parseNotebookMarkdown(NOTEBOOK_SKIPPED.markdown);
    expect(parsed.name).toBe('Pengecekan Antrian Harian');
    expect(parsed.enabledSteps).toHaveLength(1);

    const stepCode = NOTEBOOK_SKIPPED.files['steps/01-cek-antrian.js'];
    expect(stepCode).toContain("status: 'skipped'");

    const skippedSignal = { status: 'skipped' as const, reason: 'Tidak ada pesanan baru dalam antrian hari ini' };
    const outcome = evaluateCellOutcome(skippedSignal);
    expect(outcome.status).toBe('skipped');
    expect(outcome.reason).toBe('Tidak ada pesanan baru dalam antrian hari ini');

    const finalAnswer = mapSignalToOutcome(outcome, 'steps/01-cek-antrian.js', ['steps/01-cek-antrian.js']);
    expect(finalAnswer.state).toBe('skipped');
    expect(finalAnswer.reason).toBe('Tidak ada pesanan baru dalam antrian hari ini');
    expect(finalAnswer.error).toBeUndefined();
  });

  it('3. Needs_review: parses example notebook and resolves needs_review for human check', () => {
    const parsed = parseNotebookMarkdown(NOTEBOOK_NEEDS_REVIEW.markdown);
    expect(parsed.name).toBe('Rekonsiliasi Nominal Tagihan');
    expect(parsed.enabledSteps).toHaveLength(1);

    const stepCode = NOTEBOOK_NEEDS_REVIEW.files['steps/01-validasi-data.js'];
    expect(stepCode).toContain("status: 'needs_review'");

    const checkSignal = {
      status: 'needs_review' as const,
      reason: 'Selisih saldo terdeteksi: Sistem Rp 1.500.000 vs Mutasi Rp 1.450.000 (butuh konfirmasi staf)',
    };
    const outcome = evaluateCellOutcome(checkSignal);
    expect(outcome.status).toBe('needs_review');

    const finalAnswer = mapSignalToOutcome(outcome);
    expect(finalAnswer.state).toBe('needs_review');
    expect(finalAnswer.reason).toContain('Selisih saldo terdeteksi');
  });

  it('4. Session_dead: parses example notebook and returns via RESULT path, not error (D-3)', () => {
    const parsed = parseNotebookMarkdown(NOTEBOOK_SESSION_DEAD.markdown);
    expect(parsed.name).toBe('Pemeriksaan Sesi Marketplace');
    expect(parsed.enabledSteps).toHaveLength(1);

    const stepCode = NOTEBOOK_SESSION_DEAD.files['steps/01-cek-sesi.js'];
    expect(stepCode).toContain("status: 'session_dead'");

    const sessionDeadSignal = {
      status: 'session_dead' as const,
      reason: 'Halaman login terdeteksi — sesi akun telah habis atau cookie kedaluwarsa',
    };
    const outcome = evaluateCellOutcome(sessionDeadSignal);
    expect(outcome.status).toBe('session_dead');

    const finalAnswer = mapSignalToOutcome(outcome);
    // D-3: session_dead is a result, error field MUST be undefined!
    expect(finalAnswer.state).toBe('session_dead');
    expect(finalAnswer.reason).toBe('Halaman login terdeteksi — sesi akun telah habis atau cookie kedaluwarsa');
    expect(finalAnswer.error).toBeUndefined();
  });

  it('5. Exactly four states, never five: unhandled errors, null, and unknown states map to needs_review (D-1, D-2, RQ-04)', () => {
    // Unhandled exception (throw new Error)
    const errOutcome = mapFailureToOutcome(new Error('DOM selector #submit not found'));
    expect(errOutcome.state).toBe('needs_review');
    expect(errOutcome.reason).toBe('DOM selector #submit not found');
    expect(errOutcome.error).toBeDefined();
    expect(errOutcome.error?.name).toBe('Error');

    // Missing tab or broken context
    const tabMissingOutcome = mapFailureToOutcome(new Error('No tab with id: 999'), 'Tab tidak ditemukan');
    expect(tabMissingOutcome.state).toBe('needs_review');
    expect(tabMissingOutcome.error?.message).toContain('No tab with id: 999');

    // Invalid / unknown status injected by mistake
    const unknownSignal = { status: 'unknown_mystery_status' as unknown as TerminalState, reason: 'Something strange' };
    const resolvedUnknown = mapSignalToOutcome(unknownSignal);
    expect(resolvedUnknown.state).toBe('needs_review'); // Never unknown!
  });
});
