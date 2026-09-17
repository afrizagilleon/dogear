/**
 * extension/agent/runs.ts
 * Run record writer and reader for human and agent consumption (D-2, RQ-02).
 * Writes JSON run artifacts into runs/ directory.
 */

import type { ProjectStore } from '../platform/interface';
import type { RunRecord } from './types';

export function generateRunFileName(startedAt: string, stepId: string): string {
  const safeTs = startedAt.replace(/[:.]/g, '-');
  const safeId = stepId.replace(/[/\\?%*:|"<>]/g, '_');
  return `runs/${safeTs}_${safeId}.json`;
}

export async function recordRun(store: ProjectStore, record: RunRecord): Promise<string> {
  const fileName = generateRunFileName(record.startedAt, record.stepId);
  const content = JSON.stringify(record, null, 2);
  await store.writeFile(fileName, content);
  return fileName;
}

export async function listRuns(store: ProjectStore): Promise<string[]> {
  const files = await store.listFiles('runs');
  return files
    .filter((f) => f.kind === 'file' && f.path.endsWith('.json'))
    .map((f) => f.path)
    .sort();
}

export async function readRun(store: ProjectStore, path: string): Promise<RunRecord> {
  const text = await store.readFile(path);
  return JSON.parse(text) as RunRecord;
}
