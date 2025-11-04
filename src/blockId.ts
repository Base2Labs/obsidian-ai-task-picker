import { App, TFile } from "obsidian";
import { normalizeBlockId } from "./utils";
import { warn } from "./logger";

async function waitForBlockIndexed(
  app: App,
  file: TFile,
  blockId: string,
  timeoutMs = 2000
): Promise<boolean> {
  const start = Date.now();
  const normalizedId = normalizeBlockId(blockId);
  while (Date.now() - start < timeoutMs) {
    const cache = app.metadataCache.getFileCache(file);
    const isIndexed =
      !!cache?.blocks &&
      Object.prototype.hasOwnProperty.call(cache.blocks, normalizedId);
    if (isIndexed) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

export async function ensureBlockIdInBackgroundFile(
  app: App,
  task: any,
  activeFile: TFile | null
): Promise<string> {
  const path = typeof task?.path === "string" ? task.path : "";
  const rawLine = (task?.lineNumber ?? task?.lineNr ?? task?.line) as
    | number
    | undefined;

  const existing = normalizeBlockId(task?.blockLink);
  if (existing) return existing;

  if (!path || typeof rawLine !== "number") {
    return `t-${Math.random().toString(36).slice(2, 8)}`;
  }

  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile))
    return `t-${Math.random().toString(36).slice(2, 8)}`;

  // SAFETY: Never modify the active file
  if (activeFile && file.path === activeFile.path) {
    warn("Refusing to modify active file", file.path);
    return `t-${Math.random().toString(36).slice(2, 8)}`;
  }

  const lineNumber = Math.max(0, rawLine);
  const content = await app.vault.read(file);
  const lines = content.split(/\r?\n/);
  const lineIndex = Math.min(
    Math.max(0, lineNumber),
    Math.max(0, lines.length - 1)
  );
  const currentLine = lines[lineIndex] ?? "";

  const blockIdMatch = currentLine.match(/\^([A-Za-z0-9\-_]+)\s*$/);
  if (blockIdMatch) {
    const existingId = blockIdMatch[1] ?? "";
    if (existingId) {
      await waitForBlockIndexed(app, file, existingId, 1000);
      return existingId;
    }
  }

  const existingIds = new Set<string>();
  for (const line of lines) {
    const blockIdMatch = (line ?? "").match(/\^([A-Za-z0-9\-_]+)\s*$/);
    if (blockIdMatch) {
      const foundId = blockIdMatch[1] ?? "";
      if (foundId) existingIds.add(foundId);
    }
  }

  let generatedId = "";
  while (!generatedId) {
    const candidate = `t-${Math.random().toString(36).slice(2, 8)}`;
    if (!existingIds.has(candidate)) {
      generatedId = candidate;
    }
  }

  lines[lineIndex] = currentLine.replace(/\s*$/, "") + "  ^" + generatedId;
  await app.vault.modify(file, lines.join("\n"));

  const isIndexed = await waitForBlockIndexed(app, file, generatedId, 2000);
  if (!isIndexed) {
    warn("Block id not indexed within timeout; embed may briefly appear unresolved", {
      path,
      id: generatedId,
    });
  }

  return generatedId;
}
