import { App, TFile, TFolder } from "obsidian";
import { TaskItem } from "./types";
import { AiTaskPickerSettings } from "./settings";
import { normalizeBlockId, ensureMd } from "./utils";

async function getAllMarkdownFilesUnderFolder(
  app: App,
  folderPath: string
): Promise<TFile[]> {
  const results: TFile[] = [];
  const root = app.vault.getAbstractFileByPath(folderPath);

  async function visit(node: any): Promise<void> {
    if (!node) return;

    // Folder
    if (node?.children && Array.isArray(node.children)) {
      for (const child of node.children) {
        await visit(child);
      }
      return;
    }

    // File
    if (node instanceof TFile && node.extension === "md") {
      results.push(node);
    }
  }

  await visit(root);
  return results;
}

function generateUniqueTaskBlockId(existingIds: Set<string>): string {
  while (true) {
    const rand = Math.random().toString(36).slice(2, 8);
    const candidate = `t-${rand}`;
    if (!existingIds.has(candidate)) {
      existingIds.add(candidate);
      return candidate;
    }
  }
}

function isHeading(line: string): boolean {
  return /^#{1,6}\s+/.test(line);
}

function headingText(line: string): string {
  return line.replace(/^#{1,6}\s+/, "").trim();
}

function parseCreatedDateFromLine(line: string): string | null {
  // Pattern 1: created:: YYYY-MM-DD
  let m = line.match(/created::\s*(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1] ?? null;

  // Pattern 2: ➕ YYYY-MM-DD
  m = line.match(/➕\s*(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1] ?? null;

  return null;
}

async function collectTasksFromFile(
  app: App,
  file: TFile,
  activeFile: TFile | null
): Promise<TaskItem[]> {
  // Don't collect from the active file
  if (activeFile && file.path === activeFile.path) {
    return [];
  }

  const content = await app.vault.read(file);
  const lines = content.split("\n");

  let mutated = false;
  const tasks: TaskItem[] = [];

  // Track IDs that already exist in this file
  const existingIds = new Set<string>();
  for (const l of lines) {
    const m = l.match(/\^([A-Za-z0-9\-_]+)\s*$/);
    if (m && m[1]) existingIds.add(m[1]);
  }

  let currentHeading: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i] ?? "";

    // Track the current heading context
    if (isHeading(line)) {
      currentHeading = headingText(line);
    }

    // Match open/unchecked task (supports indentation)
    const taskMatch = line.match(/^\s*[-*]\s+\[\s*\]\s+(.+)$/);
    if (!taskMatch) {
      continue;
    }

    // Does it already have ^t-xxxxxx at the end?
    let blockIdMatch = line.match(/\^([A-Za-z0-9\-_]+)\s*$/);
    let blockId = blockIdMatch && blockIdMatch[1] ? blockIdMatch[1] : null;

    if (!blockId) {
      blockId = generateUniqueTaskBlockId(existingIds);
      line = line + "  ^" + blockId;
      lines[i] = line;
      mutated = true;
    }

    // Build clean text: strip bullet, checkbox, and block ID
    const taskText = line
      .replace(/^\s*[-*]\s+\[\s*\]\s+/, "")
      .replace(/\^([A-Za-z0-9\-_]+)\s*$/, "")
      .trim();

    // Parse created date markers
    const created = parseCreatedDateFromLine(line);

    tasks.push({
      id: normalizeBlockId(blockId),
      note: ensureMd(file.path),
      text: taskText,
      context: currentHeading,
      status: "open",
      created,
    });
  }

  if (mutated) {
    const newContent = lines.join("\n");
    await app.vault.modify(file, newContent);
    
    // Wait for Obsidian to index the new block IDs
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return tasks;
}

export async function collectAllOpenTasksDirect(
  app: App,
  settings: AiTaskPickerSettings,
  activeFile: TFile | null
): Promise<TaskItem[]> {
  const allTasks: TaskItem[] = [];
  const folderPaths = settings.folders ?? [];

  for (const folderPath of folderPaths) {
    const trimmedPath = folderPath.trim().replace(/^\/+|\/+$/g, "");
    if (!trimmedPath) continue;

    const files = await getAllMarkdownFilesUnderFolder(app, trimmedPath);

    for (const file of files) {
      const perFile = await collectTasksFromFile(app, file, activeFile);
      allTasks.push(...perFile);
    }
  }

  return allTasks;
}
