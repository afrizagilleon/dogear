/**
 * extension/project/notebook-parser.ts
 * Parser for notebook.md project configuration and step ordering (RQ-09, D-1).
 */

import type { ProjectStore } from '../platform/interface';
import type { KernelCell } from '../kernel/types';
import { NotebookModuleLinker } from './linker';
import { normalizeProjectPath } from './memory';

export interface NotebookStepMeta {
  path: string;
  name?: string;
  enabled?: boolean;
  world?: 'MAIN' | 'USER_SCRIPT';
}

export interface ParsedNotebook {
  name: string;
  description?: string;
  allSteps: NotebookStepMeta[];
  enabledSteps: NotebookStepMeta[];
}

export function parseNotebookMarkdown(markdown: string): ParsedNotebook {
  const frontMatterMatch = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!frontMatterMatch) {
    throw new Error('Invalid notebook.md: Missing front-matter block bounded by `---`.');
  }

  const frontMatterText = frontMatterMatch[1];
  const bodyText = markdown.slice(frontMatterMatch[0].length).trim();

  let name = 'Untitled Notebook';
  const allSteps: NotebookStepMeta[] = [];

  // Parse YAML-like frontmatter
  const lines = frontMatterText.split(/\r?\n/);
  let inSteps = false;
  let currentStep: Partial<NotebookStepMeta> | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!inSteps) {
      if (line.startsWith('name:')) {
        name = line.slice(5).trim().replace(/^['"]|['"]$/g, '');
        continue;
      }
      if (line.startsWith('steps:')) {
        inSteps = true;
        continue;
      }
    } else {
      if (line.startsWith('-')) {
        if (currentStep && currentStep.path) {
          allSteps.push({
            path: normalizeProjectPath(currentStep.path),
            name: currentStep.name || currentStep.path,
            enabled: currentStep.enabled !== false,
            world: currentStep.world || 'MAIN',
          });
        }
        currentStep = {};
        const rest = line.slice(1).trim();
        if (rest.startsWith('path:')) {
          currentStep.path = rest.slice(5).trim().replace(/^['"]|['"]$/g, '');
        }
      } else if (currentStep && line.includes(':')) {
        const colonIdx = line.indexOf(':');
        const key = line.slice(0, colonIdx).trim();
        const val = line.slice(colonIdx + 1).trim().replace(/^['"]|['"]$/g, '');

        if (key === 'path') currentStep.path = val;
        else if (key === 'name') currentStep.name = val;
        else if (key === 'enabled') currentStep.enabled = val === 'true';
        else if (key === 'world') currentStep.world = val as 'MAIN' | 'USER_SCRIPT';
      }
    }
  }

  if (currentStep && currentStep.path) {
    allSteps.push({
      path: normalizeProjectPath(currentStep.path),
      name: currentStep.name || currentStep.path,
      enabled: currentStep.enabled !== false,
      world: currentStep.world || 'MAIN',
    });
  }

  const enabledSteps = allSteps.filter((s) => s.enabled !== false);

  return {
    name,
    description: bodyText,
    allSteps,
    enabledSteps,
  };
}

export async function loadNotebookCells(
  notebookMarkdown: string,
  store: ProjectStore
): Promise<{ notebook: ParsedNotebook; cells: KernelCell[] }> {
  const notebook = parseNotebookMarkdown(notebookMarkdown);
  const linker = new NotebookModuleLinker(store);
  const cells: KernelCell[] = [];

  for (const step of notebook.enabledSteps) {
    const linkRes = await linker.link(step.path);
    cells.push({
      id: step.path,
      name: step.name || step.path,
      source: linkRes.source,
      world: step.world || 'MAIN',
      lineMap: linkRes.lineMap,
    });
  }

  return { notebook, cells };
}

export function serializeNotebookMarkdown(notebook: {
  name: string;
  description?: string;
  allSteps: Array<{ path: string; name?: string; enabled?: boolean; world?: 'MAIN' | 'USER_SCRIPT' }>;
}): string {
  const lines: string[] = [
    '---',
    `name: ${notebook.name}`,
    'steps:',
  ];
  for (const step of notebook.allSteps) {
    lines.push(`  - path: ${step.path}`);
    if (step.name) {
      lines.push(`    name: ${step.name}`);
    }
    lines.push(`    enabled: ${step.enabled !== false}`);
    if (step.world && step.world !== 'MAIN') {
      lines.push(`    world: ${step.world}`);
    }
  }
  lines.push('---');
  if (notebook.description && notebook.description.trim() !== '') {
    lines.push('');
    lines.push(notebook.description.trim());
  }
  lines.push('');
  return lines.join('\n');
}
