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

const DEBUG = true;
const TAG = "[ai-task-picker]";
function log(...args: unknown[]) { if (DEBUG) console.log(TAG, ...args); }
function warn(...args: unknown[]) { if (DEBUG) console.warn(TAG, ...args); }
function error(...args: unknown[]) { if (DEBUG) console.error(TAG, ...args); }
function group(label: string) { if (DEBUG) console.group(TAG, label); }
function groupEnd() { if (DEBUG) console.groupEnd(); }

type TaskStatus = "open";
interface TaskItem {
  id: string;
  note: string;
  text: string;
  context: string | null;
  created: string | null;
  status: TaskStatus;
}

/** Normalize any incoming block id: trim, remove leading carets/spaces. */
function normalizeBlockId(raw: unknown): string {
  return (raw ?? "")
    .toString()
    .trim()
    .replace(/^(\^|\s)+/, "")
    .trim();
}

/** Insert text at an exact cursor position without drifting */
async function insertTextAtCursor(
  app: App,
  file: TFile,
  cursor: EditorPosition,
  text: string
): Promise<void> {
  let view = app.workspace.getActiveViewOfType(MarkdownView);
  if (!view || !view.file || view.file.path !== file.path) {
    const leaf = app.workspace.getLeaf(true);
    await leaf.openFile(file);
    view = app.workspace.getActiveViewOfType(MarkdownView);
  }
  if (!view) throw new Error("Could not get MarkdownView to insert text.");

  const editor = view.editor;
  const clean = (text ?? "").replace(/^\n+/, "");

  const segments = clean.split("\n");
  const lineCount = segments.length;
  const firstLineLen = segments[0]?.length ?? 0;
  const lastLineLen = segments[lineCount - 1]?.length ?? 0;

  const end: EditorPosition = {
    line: cursor.line + Math.max(lineCount - 1, 0),
    ch: lineCount === 1 ? cursor.ch + firstLineLen : lastLineLen,
  };

  editor.replaceRange(clean, cursor);
  editor.setCursor(end);
  editor.focus();
}

/* ------------------------- Modal ----------------------------------------- */
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

/* ------------------------- Priority extraction --------------------------- */
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
    const l = lines[i] ?? "";
    const m = l.match(/^(#{1,6})\s+(.*)$/);
    if (!m) continue;
    const headingDepth = (m[1] ?? "").length;
    const headingText = m[2] ?? "";
    if (normalizeHeadingText(headingText) === normalizeHeadingText(desiredHeading)) {
      start = i;
      startDepth = headingDepth;
      break;
    }
  }

  if (start === -1) {
    log("Priorities heading not found:", desiredHeading, "in", file.path);
    return "";
  }

  const buf: string[] = [];
  let seenNonBlank = false;
  for (let j = start + 1; j < lines.length; j++) {
    const l = lines[j] ?? "";

    if (isHorizontalRule(l)) break;

    const hm = l.match(/^(#{1,6})\s+/);
    const hmDepth = hm ? (hm[1] ?? "").length : 0;
    if (hm && hmDepth <= startDepth) break;

    if (!seenNonBlank && l.trim() === "") continue;
    seenNonBlank = true;
    buf.push(l);
  }
  while (buf.length > 0 && (buf[buf.length - 1] ?? "").trim() === "") buf.pop();

  const preview = buf.slice(0, 5).join("\n");
  log(`Priorities extracted from ${file.path}: ${buf.length} lines`, "\nPreview:\n", preview);
  return buf.join("\n");
}

/* ------------------------ Tasks plugin resolver -------------------------- */
function findTasksPlugin(app: App): any | null {
  const mgr: any = (app as any).plugins;
  const plugMap: Record<string, any> = (mgr && mgr.plugins) ? mgr.plugins : {};
  if (plugMap["obsidian-tasks-plugin"]) return plugMap["obsidian-tasks-plugin"];
  const byScan = Object.values(plugMap).find((p: any) => {
    const id = (p?.manifest?.id ?? "").toLowerCase();
    const name = (p?.manifest?.name ?? "").toLowerCase();
    return id.includes("tasks") || name.includes("tasks");
  });
  return (byScan as any) ?? null;
}
function resolveTasksApi(plugin: any): { getAllTasks: () => Promise<any[]> | any[] } | null {
  if (!plugin) return null;

  const api1 = plugin?.api;
  if (api1?.getTasks) {
    log("Using Tasks API shape: plugin.api.getTasks()");
    return { getAllTasks: () => api1.getTasks() };
  }

  if (typeof plugin?.getAPI === "function") {
    const api2 = plugin.getAPI();
    if (api2?.getTasks) {
      log("Using Tasks API shape: plugin.getAPI().getTasks()");
      return { getAllTasks: () => api2.getTasks() };
    }
  }

  const v1 = api1?.v1 ?? plugin?.v1 ?? plugin?.apiV1;
  if (v1?.tasks?.getTasks) {
    log("Using Tasks API shape: plugin.api.v1.tasks.getTasks()");
    return { getAllTasks: () => v1.tasks.getTasks() };
  }
  if (v1?.getTasks) {
    log("Using Tasks API shape: plugin.api.v1.getTasks()");
    return { getAllTasks: () => v1.getTasks() };
  }

  if (typeof plugin?.getTasks === "function") {
    log("Using Tasks API shape: plugin.getTasks()");
    return { getAllTasks: () => plugin.getTasks() };
  }

  warn("No known Tasks API shape", plugin);
  return null;
}

/** Status check for “done” heuristics */
function isCompletedTask(t: any): boolean {
  const s = t?.status;
  const rawStr =
    (typeof s === "string" ? s : (s?.name ?? s?.type ?? s?.toString?.())) ?? "";
  const sString = rawStr.toString().toLowerCase();

  const doneRegex = /(done|completed|complete|cancel|🗑|✅|✔|x\b)/i;
  const bools = [t?.done, t?.completed, t?.isDone, s?.done, s?.isDone];
  const dates = [t?.doneDate, t?.completedDate, t?.completionDate];

  return bools.some((v) => v === true) || dates.some((d) => !!d) || doneRegex.test(sString);
}

/** Format created date if available from Tasks plugin shapes */
function formatCreatedDate(t: any): string | null {
  const d: any =
    (t?.createdDate && (t.createdDate.date ?? t.createdDate)) ??
    t?.created ??
    null;

  try {
    if (!d) return null;
    if (typeof d === "string") {
      return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
    }
    if (typeof d?.format === "function") {
      // e.g., moment/luxon
      return d.format("YYYY-MM-DD");
    }
    if (typeof d === "object" && d.year && d.month && d.day) {
      const mm = String(d.month).padStart(2, "0");
      const dd = String(d.day).padStart(2, "0");
      return `${d.year}-${mm}-${dd}`;
    }
  } catch {
    // ignore parse errors
  }
  return null;
}

/** Collect open tasks via Tasks plugin */
async function collectOpenTasksViaTasksPlugin(app: App, settings: AiTaskPickerSettings): Promise<TaskItem[]> {
  group("Collect via Tasks plugin");
  try {
    const plug = findTasksPlugin(app);
    const api = resolveTasksApi(plug);
    if (!plug || !api) {
      throw new Error("Tasks plugin missing or incompatible.");
    }

    const raw = await api.getAllTasks();
    const arr: any[] = Array.isArray(raw) ? raw : [];
    log("Tasks API returned", arr.length, "items");

    const roots = (settings.folders ?? [])
      .map((p) => (p ?? "").trim().replace(/^\/+|\/+$/g, ""))
      .filter((s) => s.length > 0);

    log("Folder filters (prefix match):", roots.length ? roots : "(none)");

    const inRoots = (path: string) => {
      if (!Array.isArray(roots) || roots.length === 0) return true;
      for (const r of roots) {
        if (path === r || path.startsWith(r + "/")) return true;
      }
      return false;
    };

    const inFolder = arr.filter((t) => typeof t?.path === "string" && inRoots(String(t.path)));
    log("Tasks in filtered folders:", inFolder.length);

    const open = inFolder.filter((t) => !isCompletedTask(t));
    log("Open tasks after status filter:", open.length);

    const out: TaskItem[] = [];
    for (const t of open) {
      const existing = normalizeBlockId(t?.blockLink);
      const id = existing || `t-${Math.random().toString(36).slice(2, 8)}`;
      out.push({
        id: normalizeBlockId(id),
        note: String(t.path),
        text: String(t?.description ?? "").trim(),
        context: (t?.parent?.headingText ?? t?.parent?.heading ?? null) as string | null,
        created: formatCreatedDate(t),
        status: "open",
      });
    }

    log("Final TaskItem count:", out.length);
    return out;
  } finally {
    groupEnd();
  }
}

/* ----------------------- OpenAI ranking ---------------------------------- */
async function callOpenAIRank(
  settings: AiTaskPickerSettings,
  prioritiesText: string,
  tasks: TaskItem[],
  n: number
): Promise<string[]> {
  if (!settings.openaiApiKey) throw new Error("OpenAI API key is not set.");

  const payload = {
    priorities_text: prioritiesText ?? "",
    tasks,
    max_tasks: n,
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: settings.model || "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: settings.rankingPrompt },
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
  } catch { /* ignore parse error; will fall back to empty */ }

  const ids: string[] = Array.isArray(parsed?.ranked_task_ids)
    ? parsed.ranked_task_ids.map((x: unknown) => String(x))
    : [];

  log("Ranked ids:", ids);
  return ids.slice(0, Math.max(0, n | 0));
}

/* --------------------------------- Plugin -------------------------------- */
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

          const savedCursor = editor.getCursor();

          const n = await promptForCount(this.app, 5);
          if (n == null) return;

          new Notice("Collecting open tasks…");
          const tasks = await collectOpenTasksViaTasksPlugin(this.app, this.settings);
          if (!tasks.length) { new Notice("No open tasks found."); return; }

          new Notice("Reading priorities…");
          const priorities = await extractPrioritiesFromFile(this.app, targetFile, this.settings.prioritiesHeading);
          if (!priorities.trim()) { new Notice("No priorities found."); return; }

          new Notice("Ranking with OpenAI…");
          const rankedIds = await callOpenAIRank(this.settings, priorities, tasks, n);

          const byId = new Map<string, TaskItem>(tasks.map((t) => [normalizeBlockId(t.id), t]));
          const lines: string[] = [];
          for (const id of rankedIds) {
            const t = byId.get(normalizeBlockId(id));
            if (!t) continue;
            const cleanId = normalizeBlockId(t.id);
            const cleanPath = t.note.replace(/\.md$/i, "");
            lines.push(`![[${cleanPath}#^${cleanId}]]`);
          }
          if (lines.length === 0) { new Notice("No tasks returned."); return; }

          await insertTextAtCursor(this.app, targetFile, savedCursor, lines.join("\n") + "\n");
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