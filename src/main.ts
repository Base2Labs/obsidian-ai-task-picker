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
function insertTextAtomically(editor: Editor, cursor: EditorPosition, text: string): void {
  const clean = (text ?? "").replace(/^\n+/, ""); // avoid accidental leading blank lines
  editor.setSelection(cursor, cursor);
  editor.replaceSelection(clean);

  const lines = clean.split("\n");
  const end: EditorPosition = {
    line: cursor.line + Math.max(lines.length - 1, 0),
    ch: lines.length === 1 ? cursor.ch + (lines[0]?.length ?? 0) : (lines[lines.length - 1]?.length ?? 0),
  };
  editor.setCursor(end);
  editor.focus();
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
    const l = lines[i] ?? "";
    const m = l.match(/^(#{1,6})\s+(.*)$/);
    if (!m) continue;
    const hashes: string = m[1] ?? "";
    const headingText: string = m[2] ?? "";
    if (normalizeHeadingText(headingText) === normalizeHeadingText(desiredHeading)) {
      start = i;
      startDepth = hashes.length;
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
    const hmHashes: string = (hm?.[1] ?? "");
    const hmDepth = hmHashes.length;
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

/* --------------- Tasks plugin resolver (strict) --------------- */
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

/* -------------------- Task filters & formats ------------------- */
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
function formatCreatedDate(t: any): string | null {
  const d: any =
    (t?.createdDate && ((t.createdDate as any).date ?? t.createdDate)) ??
    t?.created ??
    null;

  try {
    if (!d) return null;
    if (typeof d === "string") {
      return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
    }
    if (typeof (d as any)?.format === "function") {
      return (d as any).format("YYYY-MM-DD");
    }
    if (typeof d === "object" && (d as any).year && (d as any).month && (d as any).day) {
      const mm = String((d as any).month).padStart(2, "0");
      const dd = String((d as any).day).padStart(2, "0");
      return `${(d as any).year}-${mm}-${dd}`;
    }
  } catch {}
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
async function ensureBlockIdInBackgroundFile(app: App, task: any): Promise<string> {
  const path = typeof task?.path === "string" ? task.path : "";
  const rawLine = (task?.lineNumber ?? task?.lineNr ?? task?.line) as number | undefined;

  const existing = normalizeBlockId(task?.blockLink);
  if (existing) return existing;

  if (!path || typeof rawLine !== "number") {
    return `t-${Math.random().toString(36).slice(2, 8)}`;
  }

  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return `t-${Math.random().toString(36).slice(2, 8)}`;

  const lineNumber = Math.max(0, rawLine);
  const content = await app.vault.read(file);
  const lines = content.split(/\r?\n/);
  const idx = Math.min(Math.max(0, lineNumber), Math.max(0, lines.length - 1));
  const current = lines[idx] ?? "";

  const m = current.match(/\^([A-Za-z0-9\-_]+)\s*$/);
  if (m) {
    const id = m[1] ?? "";
    if (id) {
      await waitForBlockIndexed(app, file, id, 1000);
      return id;
    }
  }

  const existingIds = new Set<string>();
  for (const l of lines) {
    const idm = (l ?? "").match(/\^([A-Za-z0-9\-_]+)\s*$/);
    if (idm) {
      const found = idm[1] ?? "";
      if (found) existingIds.add(found);
    }
  }
  let id = "";
  while (!id) {
    const cand = `t-${Math.random().toString(36).slice(2, 8)}`;
    if (!existingIds.has(cand)) id = cand;
  }

  lines[idx] = current.replace(/\s*$/, "") + "  ^" + id;
  await app.vault.modify(file, lines.join("\n"));
  log("Appended block id in background file via vault", { path, lineNumber: idx, id });

  const ok = await waitForBlockIndexed(app, file, id, 2000);
  if (!ok) warn("Block id not indexed within timeout; embed may briefly appear unresolved", { path, id });

  return id;
}

/* ------------- Collect tasks (excluding active note) ------------- */
async function collectOpenTasksViaTasksPlugin(
  app: App,
  settings: AiTaskPickerSettings,
  activeFile: TFile | null,
): Promise<TaskItem[]> {
  group("Collect via Tasks plugin");
  try {
    const plug = findTasksPlugin(app);
    const api = resolveTasksApi(plug);
    if (!plug || !api) throw new Error("Tasks plugin missing or incompatible.");

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

    const activePath = activeFile?.path ?? null;

    const filtered = arr.filter((t) => {
      const p = String(t?.path ?? "");
      return p && inRoots(p) && (!activePath || p !== activePath); // <<< exclude active note
    });
    log("Tasks in filtered folders (excluding active note):", filtered.length);

    const open = filtered.filter((t) => !isCompletedTask(t));
    log("Open tasks after status filter:", open.length);

    const out: TaskItem[] = [];
    for (const t of open) {
      const id = await ensureBlockIdInBackgroundFile(app, t);
      out.push({
        id: normalizeBlockId(id),
        note: ensureMd(String(t.path)),
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

  const ids: string[] = Array.isArray(parsed?.ranked_task_ids)
    ? parsed.ranked_task_ids.map((x: unknown) => String(x))
    : [];

  log("Ranked ids:", ids);
  return ids.slice(0, Math.max(0, n | 0));
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

          const savedCursor = editor.getCursor();

          const n = await promptForCount(this.app, 5);
          if (n == null) return;

          new Notice("Collecting open tasks…");
          const tasks = await collectOpenTasksViaTasksPlugin(this.app, this.settings, targetFile);
          if (!tasks.length) { new Notice("No open tasks found."); return; }

          new Notice("Reading priorities…");
          const priorities = await extractPrioritiesFromFile(this.app, targetFile, this.settings.prioritiesHeading);
          if (!priorities.trim()) { new Notice("No priorities found."); return; }

          new Notice("Ranking with OpenAI…");
          const rankedIds = await callOpenAIRank(this.settings, priorities, tasks, n);

          const byId = new Map<string, TaskItem>(tasks.map((t) => [normalizeBlockId(t.id), t]));
          const embeds: string[] = [];
          for (const idRaw of rankedIds) {
            const id = normalizeBlockId(idRaw);
            const t = byId.get(id);
            if (!t) continue;

            // Confirm the block is indexed in its (background) file
            const target = this.app.vault.getAbstractFileByPath(t.note);
            if (target instanceof TFile) {
              const cache = this.app.metadataCache.getFileCache(target);
              const has = !!cache?.blocks && Object.prototype.hasOwnProperty.call(cache.blocks, id);
              if (!has) {
                warn("Skipping embed; block id not yet indexed", { path: t.note, id });
                continue;
              }
            }

            embeds.push(`![[${ensureMd(t.note)}#^${id}]]`);
          }

          if (embeds.length === 0) {
            new Notice("No tasks returned (or not yet indexed). Try again shortly.");
            return;
          }

          insertTextAtomically(editor, savedCursor, embeds.join("\n") + "\n");
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