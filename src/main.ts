import {
  App,
  Editor,
  EditorPosition,
  MarkdownView,
  Modal,
  Notice,
  Plugin,
  TFile,
} from "obsidian";
import type { MarkdownFileInfo } from "obsidian";
import {
  AiTaskPickerSettings,
  DEFAULT_SETTINGS,
  AiTaskPickerSettingTab,
} from "./settings";

const DEBUG = false;
function warn(...args: unknown[]) { if (DEBUG) console.warn("[ai-task-picker]", ...args); }
function error(...args: unknown[]) { console.error("[ai-task-picker]", ...args); }

/* ---------------- Types ---------------- */
type TaskStatus = "open";
interface TaskItem {
  id: string;
  note: string;            // full path (with .md ensured)
  text: string;
  context: string | null;
  created: string | null;
  status: TaskStatus;
}

/* ---------------- Utils ---------------- */
function normalizeBlockId(raw: unknown): string {
  return (raw ?? "")
    .toString()
    .trim()
    .replace(/^(\^|\s)+/, "")
    .trim();
}
function ensureMd(path: string): string {
  return /\.md$/i.test(path) ? path : `${path}.md`;
}
function insertTextAtCursor(editor: Editor, cursorPosition: EditorPosition, text: string): void {
  const lineCount = editor.lineCount();
  const validatedLine = Math.min(Math.max(0, cursorPosition.line), lineCount - 1);
  const lineLength = editor.getLine(validatedLine).length;
  const validatedChar = Math.min(Math.max(0, cursorPosition.ch), lineLength);
  
  const insertPosition: EditorPosition = { line: validatedLine, ch: validatedChar };
  editor.replaceRange(text, insertPosition);
  
  // Move cursor to end of inserted content and center on screen
  const insertedLines = text.split("\n");
  const endLine = validatedLine + insertedLines.length - 1;
  const lastLine = insertedLines[insertedLines.length - 1] ?? "";
  const endChar = insertedLines.length === 1 
    ? validatedChar + text.length 
    : lastLine.length;
  const endPosition: EditorPosition = { line: endLine, ch: endChar };
  
  editor.setCursor(endPosition);
  editor.scrollIntoView({ from: endPosition, to: endPosition }, true);
}

/* ---------------- Modal ---------------- */
class NumberPromptModal extends Modal {
  private resolve!: (v: number | null) => void;
  private initial: number;
  constructor(app: App, initial = 5) {
    super(app);
    this.initial = initial;
  }
  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "How many tasks should I surface?" });

    const input = contentEl.createEl("input", {
      type: "number",
      attr: { min: "1", step: "1" },
    }) as HTMLInputElement;
    input.value = String(this.initial);
    input.style.margin = "0.5em 0";
    input.style.padding = "4px";
    input.style.width = "100%";
    input.focus();
    input.select();

    const buttons = contentEl.createDiv();
    buttons.style.marginTop = "0.75em";
    buttons.style.display = "flex";
    buttons.style.gap = "0.5em";
    buttons.style.justifyContent = "flex-end";
    const ok = buttons.createEl("button", { text: "OK" });
    const cancel = buttons.createEl("button", { text: "Cancel" });

    const submit = () => {
      const n = Number(input.value);
      if (Number.isFinite(n) && n >= 1) {
        this.resolve(Math.floor(n));
        this.close();
      } else {
        new Notice("Please enter a number ≥ 1");
      }
    };
    ok.addEventListener("click", submit);
    cancel.addEventListener("click", () => { this.resolve(null); this.close(); });
    input.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") submit();
      if (e.key === "Escape") { this.resolve(null); this.close(); }
    });
  }
  onClose(): void { this.contentEl.empty(); }
  prompt(): Promise<number | null> {
    return new Promise((res) => { this.resolve = res; this.open(); });
  }
}
async function promptForCount(app: App, initial = 5): Promise<number | null> {
  const modal = new NumberPromptModal(app, initial);
  return modal.prompt();
}

/* --------- Priorities extraction (strict) ---------- */
function normalizeHeadingText(s: string): string {
  return (s ?? "")
    .replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\p{Symbol}\s]+/gu, "")
    .replace(/\(.+?\)\s*$/g, "")
    .replace(/\+/g, " plus ")
    .replace(/[’'`"]/g, "")
    .replace(/[.:•\-–—]/g, " ")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}
function isHorizontalRule(line: string): boolean {
  return /^\s*([-*_])\1{2,}\s*$/.test(line ?? "");
}
async function extractPrioritiesFromFile(
  app: App,
  file: TFile,
  desiredHeading: string
): Promise<string> {
  const content = (await app.vault.read(file)) ?? "";
  const lines = content.split(/\r?\n/);

  let start = -1;
  let startDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (!headingMatch) continue;
    const hashes = headingMatch[1] ?? "";
    const headingText = headingMatch[2] ?? "";
    if (normalizeHeadingText(headingText) === normalizeHeadingText(desiredHeading)) {
      start = i;
      startDepth = hashes.length;
      break;
    }
  }

  if (start === -1) return "";

  const buffer: string[] = [];
  let seenNonBlank = false;
  for (let j = start + 1; j < lines.length; j++) {
    const line = lines[j] ?? "";

    if (isHorizontalRule(line)) break;

    const headingMatch = line.match(/^(#{1,6})\s+/);
    if (headingMatch) {
      const hashes = headingMatch[1] ?? "";
      const headingDepth = hashes.length;
      if (headingDepth <= startDepth) break;
    }

    if (!seenNonBlank && line.trim() === "") continue;
    seenNonBlank = true;
    buffer.push(line);
  }
  while (buffer.length > 0 && (buffer[buffer.length - 1] ?? "").trim() === "") {
    buffer.pop();
  }
  return buffer.join("\n");
}

/* --------------- Tasks plugin resolver (strict) --------------- */
function findTasksPlugin(app: App): any | null {
  const pluginManager: any = (app as any).plugins;
  const pluginMap: Record<string, any> = (pluginManager?.plugins) ? pluginManager.plugins : {};
  
  if (pluginMap["obsidian-tasks-plugin"]) {
    return pluginMap["obsidian-tasks-plugin"];
  }
  
  const foundPlugin = Object.values(pluginMap).find((plugin: any) => {
    const pluginId = (plugin?.manifest?.id ?? "").toLowerCase();
    const pluginName = (plugin?.manifest?.name ?? "").toLowerCase();
    return pluginId.includes("tasks") || pluginName.includes("tasks");
  });
  
  return foundPlugin ?? null;
}
function resolveTasksApi(plugin: any): { getAllTasks: () => Promise<any[]> | any[] } | null {
  if (!plugin) return null;

  const directApi = plugin?.api;
  if (directApi?.getTasks) {
    return { getAllTasks: () => directApi.getTasks() };
  }

  if (typeof plugin?.getAPI === "function") {
    const factoryApi = plugin.getAPI();
    if (factoryApi?.getTasks) {
      return { getAllTasks: () => factoryApi.getTasks() };
    }
  }

  const legacyApi = directApi?.v1 ?? plugin?.v1 ?? plugin?.apiV1;
  if (legacyApi?.tasks?.getTasks) {
    return { getAllTasks: () => legacyApi.tasks.getTasks() };
  }
  if (legacyApi?.getTasks) {
    return { getAllTasks: () => legacyApi.getTasks() };
  }

  if (typeof plugin?.getTasks === "function") {
    return { getAllTasks: () => plugin.getTasks() };
  }

  warn("No known Tasks API shape found", plugin);
  return null;
}

/* -------------------- Task filters & formats ------------------- */
function isCompletedTask(task: any): boolean {
  if (!task) return false;
  
  const status = task.status;
  const statusString = (typeof status === "string" 
    ? status 
    : (status?.name ?? status?.type ?? status?.toString?.())) ?? "";
  const normalizedStatus = statusString.toString().toLowerCase();

  const completionPattern = /(done|completed|complete|cancel|🗑|✅|✔|x\b)/i;
  const booleanFlags = [
    task.done, 
    task.completed, 
    task.isDone, 
    status?.done, 
    status?.isDone
  ];
  const completionDates = [
    task.doneDate, 
    task.completedDate, 
    task.completionDate
  ];

  return booleanFlags.some((flag) => flag === true) 
    || completionDates.some((date) => !!date) 
    || completionPattern.test(normalizedStatus);
}
function formatCreatedDate(task: any): string | null {
  if (!task) return null;
  
  const dateValue: any =
    (task.createdDate && ((task.createdDate as any).date ?? task.createdDate)) ??
    task.created ??
    null;

  try {
    if (!dateValue) return null;
    
    if (typeof dateValue === "string") {
      return /^\d{4}-\d{2}-\d{2}$/.test(dateValue) ? dateValue : null;
    }
    
    if (typeof (dateValue as any)?.format === "function") {
      return (dateValue as any).format("YYYY-MM-DD");
    }
    
    if (typeof dateValue === "object" && dateValue.year && dateValue.month && dateValue.day) {
      const month = String(dateValue.month).padStart(2, "0");
      const day = String(dateValue.day).padStart(2, "0");
      return `${dateValue.year}-${month}-${day}`;
    }
  } catch (err) {
    // Silently fail and return null
  }
  return null;
}

/* ----------- Block ID ensuring (background files only) ----------- */
/** Wait until the metadata cache indexes a specific block id in a file */
async function waitForBlockIndexed(app: App, file: TFile, blockId: string, timeoutMs = 2000): Promise<boolean> {
  const start = Date.now();
  const id = normalizeBlockId(blockId);
  while (Date.now() - start < timeoutMs) {
    const cache = app.metadataCache.getFileCache(file);
    const has = !!cache?.blocks && Object.prototype.hasOwnProperty.call(cache.blocks, id);
    if (has) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

/** Ensure or create a block id for a task that resides in a BACKGROUND file. */
async function ensureBlockIdInBackgroundFile(app: App, task: any, activeFile: TFile | null): Promise<string> {
  const path = typeof task?.path === "string" ? task.path : "";
  const rawLine = (task?.lineNumber ?? task?.lineNr ?? task?.line) as number | undefined;

  const existing = normalizeBlockId(task?.blockLink);
  if (existing) return existing;

  if (!path || typeof rawLine !== "number") {
    return `t-${Math.random().toString(36).slice(2, 8)}`;
  }

  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return `t-${Math.random().toString(36).slice(2, 8)}`;
  
  // SAFETY: Never modify the active file
  if (activeFile && file.path === activeFile.path) {
    warn("Refusing to modify active file", file.path);
    return `t-${Math.random().toString(36).slice(2, 8)}`;
  }

  const lineNumber = Math.max(0, rawLine);
  const content = await app.vault.read(file);
  const lines = content.split(/\r?\n/);
  const idx = Math.min(Math.max(0, lineNumber), Math.max(0, lines.length - 1));
  const current = lines[idx] ?? "";

  const blockIdMatch = current.match(/\^([A-Za-z0-9\-_]+)\s*$/);
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

  lines[idx] = current.replace(/\s*$/, "") + "  ^" + generatedId;
  await app.vault.modify(file, lines.join("\n"));

  const isIndexed = await waitForBlockIndexed(app, file, generatedId, 2000);
  if (!isIndexed) {
    warn("Block id not indexed within timeout; embed may briefly appear unresolved", { path, id: generatedId });
  }

  return generatedId;
}

/* ------------- Collect tasks (excluding active note) ------------- */
async function collectOpenTasksViaTasksPlugin(
  app: App,
  settings: AiTaskPickerSettings,
  activeFile: TFile | null,
): Promise<TaskItem[]> {
  const tasksPlugin = findTasksPlugin(app);
  const tasksApi = resolveTasksApi(tasksPlugin);
  if (!tasksPlugin || !tasksApi) {
    throw new Error("Tasks plugin missing or incompatible.");
  }

  const allTasks = await tasksApi.getAllTasks();
  const tasksArray: any[] = Array.isArray(allTasks) ? allTasks : [];

  const folderRoots = (settings.folders ?? [])
    .map((folderPath) => (folderPath ?? "").trim().replace(/^\/+|\/+$/g, ""))
    .filter((folderPath) => folderPath.length > 0);

  const isInConfiguredFolders = (taskPath: string) => {
    if (folderRoots.length === 0) return true;
    return folderRoots.some((root) => taskPath === root || taskPath.startsWith(root + "/"));
  };

  const activeFilePath = activeFile?.path ?? null;

  const filteredTasks = tasksArray.filter((task) => {
    const taskPath = String(task?.path ?? "");
    return taskPath && isInConfiguredFolders(taskPath) && taskPath !== activeFilePath;
  });

  const openTasks = filteredTasks.filter((task) => !isCompletedTask(task));

  const taskItems: TaskItem[] = [];
  for (const task of openTasks) {
    const blockId = await ensureBlockIdInBackgroundFile(app, task, activeFile);
    taskItems.push({
      id: normalizeBlockId(blockId),
      note: ensureMd(String(task.path)),
      text: String(task?.description ?? "").trim(),
      context: (task?.parent?.headingText ?? task?.parent?.heading ?? null) as string | null,
      created: formatCreatedDate(task),
      status: "open",
    });
  }

  return taskItems;
}

/* ------------------- OpenAI ranking (strict) ------------------ */
async function callOpenAIRank(
  settings: AiTaskPickerSettings,
  prioritiesText: string,
  tasks: TaskItem[],
  n: number
): Promise<string[]> {
  const apiKey = settings.openaiApiKey || "";
  if (!apiKey) throw new Error("OpenAI API key is not set.");

  const systemPrompt = settings.rankingPrompt || DEFAULT_SETTINGS.rankingPrompt;
  const model = settings.model || "gpt-4o-mini";

  const payload = {
    priorities_text: prioritiesText ?? "",
    tasks,
    max_tasks: n,
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(payload) },
      ],
    }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(txt || `OpenAI error ${res.status}`);
  }

  const json = await res.json().catch(() => null);
  const content = json?.choices?.[0]?.message?.content ?? "";
  let parsed: any = {};
  try {
    parsed = JSON.parse(content.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/i, "").trim());
  } catch { /* ignore */ }

  const rankedIds: string[] = Array.isArray(parsed?.ranked_task_ids)
    ? parsed.ranked_task_ids.map((id: unknown) => String(id))
    : [];

  return rankedIds.slice(0, Math.max(0, n | 0));
}

/* ----------------------------- Plugin ----------------------------- */
export default class AiTaskPickerPlugin extends Plugin {
  settings: AiTaskPickerSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.addSettingTab(new AiTaskPickerSettingTab(this.app, this));

    this.addCommand({
      id: "insert-ranked-tasks-at-cursor",
      name: "AI: Insert ranked tasks at cursor",
      editorCallback: async (editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
        try {
          const targetFile: TFile | null =
            (ctx as MarkdownFileInfo)?.file ??
            (ctx as MarkdownView)?.file ??
            this.app.workspace.getActiveFile();
          if (!targetFile) { new Notice("Open a note first."); return; }

          // Save cursor position and document state IMMEDIATELY before showing modal
          const savedCursor = editor.getCursor();
          const initialContent = editor.getValue();

          const taskCount = await promptForCount(this.app, 5);
          if (taskCount == null) return;

          new Notice("Collecting open tasks…");
          const tasks = await collectOpenTasksViaTasksPlugin(this.app, this.settings, targetFile);
          
          // Restore content if unexpectedly modified during task collection
          if (editor.getValue() !== initialContent) {
            warn("Active file was modified during task collection! Restoring original content.");
            editor.setValue(initialContent);
          }
          
          if (!tasks.length) {
            new Notice("No open tasks found.");
            return;
          }

          new Notice("Reading priorities…");
          const priorities = await extractPrioritiesFromFile(this.app, targetFile, this.settings.prioritiesHeading);
          if (!priorities.trim()) {
            new Notice("No priorities found.");
            return;
          }

          new Notice("Ranking with OpenAI…");
          const rankedIds = await callOpenAIRank(this.settings, priorities, tasks, taskCount);

          const tasksById = new Map<string, TaskItem>(
            tasks.map((task) => [normalizeBlockId(task.id), task])
          );
          
          const taskEmbeds: string[] = [];
          for (const rawId of rankedIds) {
            const blockId = normalizeBlockId(rawId);
            const task = tasksById.get(blockId);
            if (!task) continue;

            // Confirm the block is indexed in its background file
            const targetFile = this.app.vault.getAbstractFileByPath(task.note);
            if (targetFile instanceof TFile) {
              const fileCache = this.app.metadataCache.getFileCache(targetFile);
              const isBlockIndexed = !!fileCache?.blocks && Object.prototype.hasOwnProperty.call(fileCache.blocks, blockId);
              if (!isBlockIndexed) {
                warn("Skipping embed; block id not yet indexed", { path: task.note, id: blockId });
                continue;
              }
            }

            taskEmbeds.push(`![[${ensureMd(task.note)}#^${blockId}]]`);
          }

          if (taskEmbeds.length === 0) {
            new Notice("No tasks returned (or not yet indexed). Try again shortly.");
            return;
          }

          insertTextAtCursor(editor, savedCursor, taskEmbeds.join("\n") + "\n");
          new Notice("Inserted ranked task embeds ✅");
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          error("Command failure:", e);
          new Notice(`AI Task Picker error: ${msg}`);
        }
      },
    });
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}