/**
 * extension/agent/processor.ts
 * Agent request processor (D-3, D-4, D-5, RQ-03, RQ-04, RQ-05, RQ-07).
 * Reads requests from requests/*.json, validates consent via siteRegistry,
 * executes steps via kernelService, writes results to runs/, and moves
 * processed requests to requests/processed/.
 */

import type { ProjectStore, PlatformAdapter } from '../platform/interface';
import { getPlatformAdapter } from '../platform';
import { siteRegistry } from '../registry';
import { kernelService } from '../kernel/service';
import { recordRun } from './runs';
import { loadNotebookCells } from '../project/notebook-parser';
import { serializeError, formatKernelError } from '../kernel/errors';
import type { AgentStepRequest } from './types';

export interface ProcessRequestResult {
  ok: boolean;
  requestFile: string;
  processedFile: string;
  runFile?: string;
  error?: unknown;
}

export function sanitizeRequestName(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || filePath;
}

export async function processAgentRequestFile(
  store: ProjectStore,
  requestFilePath: string,
  options?: {
    tabId?: number;
    platformAdapter?: PlatformAdapter;
  }
): Promise<ProcessRequestResult> {
  const platform = options?.platformAdapter || getPlatformAdapter();
  const baseName = sanitizeRequestName(requestFilePath);
  const processedPath = `requests/processed/${baseName}`;
  const startedAt = new Date().toISOString();

  let rawRequestText = '';
  try {
    rawRequestText = await store.readFile(requestFilePath);
  } catch (readErr) {
    return {
      ok: false,
      requestFile: requestFilePath,
      processedFile: processedPath,
      error: readErr,
    };
  }

  // 1. Parse request JSON
  let req: AgentStepRequest;
  try {
    req = JSON.parse(rawRequestText) as AgentStepRequest;
    if (!req || typeof req !== 'object' || !req.stepId) {
      throw new Error("Field 'stepId' wajib diisi pada berkas request.");
    }
  } catch (parseErr: unknown) {
    const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
    const errObj = {
      name: 'MalformedRequestError',
      message: `Berkas request '${baseName}' tidak valid: ${msg}`,
      cause: 'Isi berkas tidak dapat diparsing sebagai JSON yang sah atau tidak memuat field stepId.',
      action: 'Periksa format JSON pada berkas request dan pastikan field stepId tersedia.',
    };
    const completedAt = new Date().toISOString();
    const runFile = await recordRun(store, {
      stepId: baseName,
      startedAt,
      completedAt,
      status: 'error',
      output: formatKernelError(errObj, ''),
      error: serializeError(errObj),
      host: 'unknown',
    });

    const moveErr = await moveProcessedRequest(store, requestFilePath, processedPath, rawRequestText);
    return {
      ok: false,
      requestFile: requestFilePath,
      processedFile: processedPath,
      runFile,
      error: moveErr ?? errObj,
    };
  }

  // 2. Read and parse notebook.md
  let notebookMd = '';
  try {
    notebookMd = await store.readFile('notebook.md');
  } catch {
    const errObj = {
      name: 'NotebookNotFoundError',
      message: "Berkas 'notebook.md' tidak ditemukan di project store.",
      cause: 'Folder project belum memuat berkas notebook.md atau handle folder tidak memiliki izin.',
      action: 'Pastikan notebook.md ada di root folder project sebelum mengirim request agent.',
    };
    const completedAt = new Date().toISOString();
    const runFile = await recordRun(store, {
      stepId: req.stepId,
      startedAt,
      completedAt,
      status: 'error',
      output: formatKernelError(errObj, ''),
      error: serializeError(errObj),
      host: req.host || 'unknown',
    });

    const moveErr = await moveProcessedRequest(store, requestFilePath, processedPath, rawRequestText);
    return {
      ok: false,
      requestFile: requestFilePath,
      processedFile: processedPath,
      runFile,
      error: moveErr ?? errObj,
    };
  }

  let loadedNotebook: {
    cells: Array<{
      id: string;
      name?: string;
      source: string;
      lineMap?: Array<{ filePath: string; startLine: number; endLine: number; originalContent: string }>;
    }>;
  };
  try {
    loadedNotebook = await loadNotebookCells(notebookMd, store);
  } catch (nbParseErr: unknown) {
    const msg = nbParseErr instanceof Error ? nbParseErr.message : String(nbParseErr);
    const errObj = {
      name: 'NotebookCorruptedError',
      message: `Notebook rusak: ${msg}`,
      cause: 'Format berkas notebook.md tidak dapat diparsing atau dependensi modul bermasalah.',
      action: 'Periksa sintaks YAML frontmatter dan struktur modul pada notebook.md.',
    };
    const completedAt = new Date().toISOString();
    const runFile = await recordRun(store, {
      stepId: req.stepId,
      startedAt,
      completedAt,
      status: 'error',
      output: formatKernelError(errObj, ''),
      error: serializeError(errObj),
      host: req.host || 'unknown',
    });

    const moveErr = await moveProcessedRequest(store, requestFilePath, processedPath, rawRequestText);
    return {
      ok: false,
      requestFile: requestFilePath,
      processedFile: processedPath,
      runFile,
      error: moveErr ?? errObj,
    };
  }

  // 3. Find requested step
  const targetCell = loadedNotebook.cells.find(
    (c) =>
      c.id === req.stepId ||
      c.name === req.stepId ||
      c.id === `steps/${req.stepId}` ||
      c.id.endsWith(req.stepId)
  );

  if (!targetCell) {
    const errObj = {
      name: 'StepNotFoundError',
      message: `Step '${req.stepId}' tidak ditemukan di notebook.`,
      cause: 'Definisi step telah dihapus atau tidak terdaftar di notebook.md.',
      action: 'Periksa daftar steps pada notebook.md dan pastikan nama step cocok.',
    };
    const completedAt = new Date().toISOString();
    const runFile = await recordRun(store, {
      stepId: req.stepId,
      startedAt,
      completedAt,
      status: 'error',
      output: formatKernelError(errObj, ''),
      error: serializeError(errObj),
      host: req.host || 'unknown',
    });

    const moveErr = await moveProcessedRequest(store, requestFilePath, processedPath, rawRequestText);
    return {
      ok: false,
      requestFile: requestFilePath,
      processedFile: processedPath,
      runFile,
      error: moveErr ?? errObj,
    };
  }

  // 4. Resolve target host and tab
  let targetTabId = req.tabId ?? options?.tabId;
  let targetHost = req.host;

  if (!targetHost && targetTabId !== undefined && platform.getTabHost) {
    targetHost = await platform.getTabHost(targetTabId);
  }
  if (!targetHost) {
    targetHost = (typeof location !== 'undefined' && location.host) ? location.host : 'default';
  }

  // 5. Check Site Registry consent guard (D-5, RQ-04, §3.4)
  const isRegistered = await siteRegistry.isRegistered(targetHost);
  if (!isRegistered) {
    const errObj = {
      name: 'SiteNotRegisteredError',
      message: `Situs '${targetHost}' belum terdaftar di registry.`,
      cause: 'Pemanggilan step dari agent dibatasi hanya untuk situs yang telah didaftarkan pengguna.',
      action: 'Daftarkan situs ini melalui Site Registry sebelum menjalankan request agent.',
    };
    const completedAt = new Date().toISOString();
    const runFile = await recordRun(store, {
      stepId: targetCell.name || targetCell.id,
      startedAt,
      completedAt,
      status: 'error',
      output: formatKernelError(errObj, targetCell.source),
      error: serializeError(errObj),
      host: targetHost,
    });

    const moveErr = await moveProcessedRequest(store, requestFilePath, processedPath, rawRequestText);
    return {
      ok: false,
      requestFile: requestFilePath,
      processedFile: processedPath,
      runFile,
      error: moveErr ?? errObj,
    };
  }

  // 6. Execute step via kernelService (INV-9: satu service, banyak pemanggil)
  const runResult = await kernelService.runCell(targetCell, {
    tabId: targetTabId,
    host: targetHost,
    projectStore: store,
    trigger: 'agent',
    platformAdapter: platform,
  });

  // 7. Move processed request file to requests/processed/ (D-4, RQ-05)
  const moveErr = await moveProcessedRequest(store, requestFilePath, processedPath, rawRequestText);
  if (moveErr) {
    return {
      ok: false,
      requestFile: requestFilePath,
      processedFile: processedPath,
      error: moveErr,
    };
  }

  return {
    ok: runResult.ok,
    requestFile: requestFilePath,
    processedFile: processedPath,
    error: runResult.error,
  };
}

type MoveRequestError = {
  name: string;
  message: string;
  cause: string;
  action: string;
};

function moveWriteError(path: string, err: unknown): MoveRequestError {
  return {
    name: 'RequestWriteError',
    message: `Gagal menulis berkas request terproses '${path}'.`,
    cause: err instanceof Error ? err.message : String(err),
    action: 'Periksa izin Origin Private File System lalu kirim ulang request.',
  };
}

async function moveProcessedRequest(
  store: ProjectStore,
  fromPath: string,
  toPath: string,
  content: string
): Promise<MoveRequestError | undefined> {
  const stagingPath = `${toPath}.staging`;
  try {
    await store.writeFile(stagingPath, content);
  } catch (err: unknown) {
    return moveWriteError(stagingPath, err);
  }
  try {
    await store.deleteFile(fromPath);
  } catch (err: unknown) {
    return {
      name: 'RequestDeleteError',
      message: `Gagal menghapus berkas request asal '${fromPath}' setelah menulis '${toPath}'.`,
      cause: err instanceof Error ? err.message : String(err),
      action: 'Hapus berkas asal secara manual jika masih ada, lalu jangan kirim duplikat request.',
    };
  }
  try {
    await store.writeFile(toPath, content);
  } catch (err: unknown) {
    try {
      await store.writeFile(fromPath, content);
    } catch {}
    return moveWriteError(toPath, err);
  }
  try {
    await store.deleteFile(stagingPath);
  } catch {}
  return undefined;
}
