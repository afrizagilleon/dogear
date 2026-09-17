/**
 * extension/native/unit-outcome-mapping.test.ts
 * Unit test: Four terminal states programmatic dispatch and mapping with mock executor (T-06 unit companion).
 * (True in-browser execution with real userScripts executor is proven by the in-browser suite kept in the development repo).
 * Proves that session_dead is distinguished from needs_review programmatically WITHOUT inspecting message strings.
 */

import { describe, it, expect } from 'vitest';
import { NativeBridge } from './bridge';
import { MemoryProjectStore } from '../project/memory';
import {
  NOTEBOOK_COMPLETED,
  NOTEBOOK_SKIPPED,
  NOTEBOOK_NEEDS_REVIEW,
  NOTEBOOK_SESSION_DEAD,
} from './fixtures';
import type { PlatformAdapter, ScriptExecutionOptions, ScriptExecutionResult } from '../platform/interface';

describe('Unit Companion: Four Terminal States Programmatic Mapping (RQ-02, D-1, D-2, D-3)', () => {
  it('dispatches four terminal states and verifies programmatic decisions without string parsing', async () => {
    const store = new MemoryProjectStore();

    // Shared execution context for realistic cell chaining (ctx.data)
    const mockExecutionContext = {
      data: {} as Record<string, unknown>,
    };

    const mockPlatform: Partial<PlatformAdapter> = {
      scriptExecutor: {
        executeScript: async (options: ScriptExecutionOptions): Promise<ScriptExecutionResult> => {
          if (options.cellId === 'steps/01-ambil-pesanan.js') {
            mockExecutionContext.data.nomorPesanan = 'INV-2026-0901';
            mockExecutionContext.data.itemCount = 3;
            return {
              ok: true,
              output: 'Pesanan ditemukan: INV-2026-0901',
              result: { status: 'completed', data: { nomorPesanan: 'INV-2026-0901' } },
            };
          }
          if (options.cellId === 'steps/02-konfirmasi.js') {
            mockExecutionContext.data.statusPemrosesan = 'SUKSES';
            return {
              ok: true,
              output: 'Pesanan berhasil diproses: INV-2026-0901',
              result: {
                status: 'completed',
                data: { statusPemrosesan: 'SUKSES', nomorPesanan: mockExecutionContext.data.nomorPesanan },
              },
            };
          }
          if (options.cellId === 'steps/01-cek-antrian.js') {
            return {
              ok: true,
              output: 'Memeriksa antrian pesanan... Jumlah pending: 0',
              result: { status: 'skipped', reason: 'Tidak ada pesanan baru dalam antrian hari ini' },
            };
          }
          if (options.cellId === 'steps/01-validasi-data.js') {
            return {
              ok: true,
              output: 'Selisih saldo terdeteksi',
              result: {
                status: 'needs_review',
                reason: 'Selisih saldo terdeteksi: Sistem Rp 1.500.000 vs Mutasi Rp 1.450.000 (butuh konfirmasi staf)',
              },
            };
          }
          if (options.cellId === 'steps/01-cek-sesi.js') {
            return {
              ok: true,
              output: 'Halaman login terdeteksi',
              result: {
                status: 'session_dead',
                reason: 'Halaman login terdeteksi — sesi akun telah habis atau cookie kedaluwarsa',
              },
            };
          }
          return { ok: true, output: 'ok' };
        },
      },
    };

    const bridge = new NativeBridge({
      platformAdapter: mockPlatform as PlatformAdapter,
      projectStore: store,
    });

    // =========================================================================
    // 1. Notebook 1: COMPLETED
    // =========================================================================
    mockExecutionContext.data = {};
    const resCompleted = await bridge.handleMessage({
      action: 'run',
      notebook_id: NOTEBOOK_COMPLETED.id,
      notebook: NOTEBOOK_COMPLETED.markdown,
      files: NOTEBOOK_COMPLETED.files,
      tabId: 101,
    });

    expect(resCompleted.type).toBe('outcome');
    if (resCompleted.type === 'outcome') {
      expect(resCompleted.state).toBe('completed');
      expect(resCompleted.error).toBeUndefined();
      expect(resCompleted.lastSuccessCellId).toBe('steps/02-konfirmasi.js');
      expect(resCompleted.executedCellIds).toEqual(['steps/01-ambil-pesanan.js', 'steps/02-konfirmasi.js']);
      expect(resCompleted.data).toEqual({
        statusPemrosesan: 'SUKSES',
        nomorPesanan: 'INV-2026-0901',
      });
    }

    // =========================================================================
    // 2. Notebook 2: SKIPPED
    // =========================================================================
    mockExecutionContext.data = {};
    const resSkipped = await bridge.handleMessage({
      action: 'run',
      notebook_id: NOTEBOOK_SKIPPED.id,
      notebook: NOTEBOOK_SKIPPED.markdown,
      files: NOTEBOOK_SKIPPED.files,
      tabId: 101,
    });

    expect(resSkipped.type).toBe('outcome');
    if (resSkipped.type === 'outcome') {
      expect(resSkipped.state).toBe('skipped');
      expect(resSkipped.error).toBeUndefined();
      expect(resSkipped.reason).toBe('Tidak ada pesanan baru dalam antrian hari ini');
    }

    // =========================================================================
    // 3. Notebook 3: NEEDS_REVIEW
    // =========================================================================
    mockExecutionContext.data = {};
    const resNeedsReview = await bridge.handleMessage({
      action: 'run',
      notebook_id: NOTEBOOK_NEEDS_REVIEW.id,
      notebook: NOTEBOOK_NEEDS_REVIEW.markdown,
      files: NOTEBOOK_NEEDS_REVIEW.files,
      tabId: 101,
    });

    expect(resNeedsReview.type).toBe('outcome');
    if (resNeedsReview.type === 'outcome') {
      expect(resNeedsReview.state).toBe('needs_review');
      expect(resNeedsReview.reason).toContain('Selisih saldo terdeteksi');
    }

    // =========================================================================
    // 4. Notebook 4: SESSION_DEAD
    // =========================================================================
    mockExecutionContext.data = {};
    const resSessionDead = await bridge.handleMessage({
      action: 'run',
      notebook_id: NOTEBOOK_SESSION_DEAD.id,
      notebook: NOTEBOOK_SESSION_DEAD.markdown,
      files: NOTEBOOK_SESSION_DEAD.files,
      tabId: 101,
    });

    expect(resSessionDead.type).toBe('outcome');
    if (resSessionDead.type === 'outcome') {
      expect(resSessionDead.state).toBe('session_dead');
      expect(resSessionDead.reason).toContain('Halaman login terdeteksi');
      // D-3: Session dead lewat jalur hasil, BUKAN lewat error!
      expect(resSessionDead.error).toBeUndefined();
    }

    // =========================================================================
    // VERIFIKASI PEMBEDAAN PROGRAMATIK TANPA MEMBACA TEKS PESAN (D-3, RQ-02):
    // =========================================================================
    // Pemanggil membedakan session_dead dari needs_review hanya dengan melihat nilai enum state:
    const dispatchDecision = (msg: typeof resSessionDead): string => {
      if (msg.type !== 'outcome') return 'unknown';
      switch (msg.state) {
        case 'session_dead':
          return 'ACTION_ALERT_CLIENT_LOGIN_EXPIRED';
        case 'needs_review':
          return 'ACTION_QUEUE_FOR_STAFF_REVIEW';
        case 'skipped':
          return 'ACTION_LOG_SKIPPED';
        case 'completed':
          return 'ACTION_RECORD_SUCCESS';
      }
    };

    expect(dispatchDecision(resCompleted)).toBe('ACTION_RECORD_SUCCESS');
    expect(dispatchDecision(resSkipped)).toBe('ACTION_LOG_SKIPPED');
    expect(dispatchDecision(resNeedsReview)).toBe('ACTION_QUEUE_FOR_STAFF_REVIEW');
    expect(dispatchDecision(resSessionDead)).toBe('ACTION_ALERT_CLIENT_LOGIN_EXPIRED');

    // Mutually exclusive: decision for session_dead is completely different from needs_review
    expect(dispatchDecision(resSessionDead)).not.toBe(dispatchDecision(resNeedsReview));
  });
});
