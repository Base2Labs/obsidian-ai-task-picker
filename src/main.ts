import {
  App,
  Editor,
  MarkdownView,
  Notice,
  Plugin,
  TAbstractFile,
  TFile,
  TFolder,
} from "obsidian";
import {
  AiTaskPickerSettings,
  DEFAULT_SETTINGS,
  AiTaskPickerSettingTab,
} from "./settings";

type TaskStatus = "open";
interface TaskItem {
  id: string;
  note: string;          // file path
  text: string;          // task text (no checkbox, no block id)
  context: string | null;// nearest heading context
  created: string | null;// YYYY-MM-DD if found
  status: TaskStatus;
}

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

function isHeadingLine(line: string): boolean {
  return /^#{1,6}\s+/.test(line);
}
function isHorizontalRule(line: string): boolean {
  return /^\s*([-*_])\1{2,}\s*$/.test(line);
}

function parseCreatedDateFromLine(line: string): string | null {
  let m = line.match(/created::\s*(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  m = line.match(/➕\s*(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  return null;
}

/** Walk a folder recursively and return all markdown files. */
async function walkMarkdownFilesInFolder(app: App, folderPath: string): Promise<TFile[]> {
  const root = app.vault.getAbstractFileByPath(folderPath);
  const out: TFile[] = [];

  async function visit(node: TAbstractFile | null): Promise<void> {
    if (!node) return;
    if (node instanceof TFolder) {
      for (const child of node.children) await visit(child);
    } else if (node instanceof TFile && node.extension === "md") {
      out.push(node);
    }
  }

  await visit(root);
  return out;
}

/** Ensure block IDs on open tasks in a file and collect them. */
async function ensureBlockIdsAndCollectTasks(app: App, file: TFile): Promise<{
  tasks: TaskItem[];
  mutated: boolean;
  newContent?: string;
}> {
  const content = await app.vault.read(file);
  const lines = content.split("\n");
  let mutated = false;
  const tasks: TaskItem[] = [];
  const existing = new Set<string>();

  // index existing block ids
  for (const l of lines) {
    const m = l.match(/\^([A-Za-z0-9\-_]+)\s*$/);
    if (m) existing.add(m[1]);
  }

  let currentHeading: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Track section context
    if (isHeadingLine(line)) {
      const m = line.match(/^#{1,6}\s+(.*)$/);
      currentHeading = m ? m[1].trim() : currentHeading;
    }

    // Open tasks only
    const taskMatch = line.match(/^\s*[-*]\s+\[\s*\]\s+(.+)$/);
    if (!taskMatch) continue;

    // Block id
    let blockIdMatch = line.match(/\^([A-Za-z0-9\-_]+)\s*$/);
    let blockId = blockIdMatch ? blockIdMatch[1] : null;
    if (!blockId) {
      // generate unique
      while (true) {
        const rand = Math.random().toString(36).slice(2, 8);
        const candidate = `t-${rand}`;
        if (!existing.has(candidate)) {
          existing.add(candidate);
          blockId = candidate;
          break;
        }
      }
      line = line + "  ^" + blockId;
      lines[i] = line;
      mutated = true;
    }

    const taskText = line
      .replace(/^\s*[-*]\s+\[\s*\]\s+/, "")
      .replace(/\^([A-Za-z0-9\-_]+)\s*$/, "")
      .trim();

    tasks.push({
      id: blockId!,
      note: file.path,
      text: taskText,
      context: currentHeading,
      created: parseCreatedDateFromLine(line),
      status: "open",
    });
  }

  return { tasks, mutated, newContent: mutated ? lines.join("\n") : undefined };
}

/** Collect all open tasks across folders; auto-assign block ids for consistency. */
async function collectAllOpenTasks(app: App, folders: string[]): Promise<TaskItem[]> {
  const files: TFile[] = [];
  for (const f of folders) {
    const arr = await walkMarkdownFilesInFolder(app, f);
    files.push(...arr);
  }

  const all: TaskItem[] = [];
  for (const file of files) {
    const { tasks, mutated, newContent } = await ensureBlockIdsAndCollectTasks(app, file);
    if (mutated && newContent) await app.vault.modify(file, newContent);
    all.push(...tasks);
  }
  return all;
}

/** Extract the priorities text from the active note under a named heading. */
async function extractPrioritiesFromActiveNote(app: App, desiredHeading: string): Promise<string> {
  const file = app.workspace.getActiveFile();
  if (!file) return "";
  const content = await app.vault.read(file);
  const lines = content.split("\n");

  let start = -1;
  let startDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const m = l.match(/^(#{1,6})\s+(.*)$/);
    if (!m) continue;
    if (normalizeHeadingText(m[2]) === normalizeHeadingText(desiredHeading)) {
      start = i;
      startDepth = m[1].length;
      break;
    }
  }
  if (start === -1) return "";

  const buf: string[] = [];
  let seenNonBlank = false;
  for (let j = start + 1; j < lines.length; j++) {
    const l = lines[j];
    if (isHorizontalRule(l)) break;
    const hm = l.match(/^(#{1,6})\s+/);
    if (hm && parseInt(hm[1].length as unknown as string) <= startDepth) break;
    if (!seenNonBlank && l.trim() === "") continue;
    seenNonBlank = true;
    buf.push(l);
  }
  while (buf.length && buf[buf.length - 1].trim() === "") buf.pop();
  return buf.join("\n");
}

/** Call OpenAI Chat Completions to rank tasks; returns validated ids. */
async function callOpenAIRank(
  settings: AiTaskPickerSettings,
  prioritiesText: string,
  tasks: TaskItem[],
  n: number,
): Promise<string[]> {
  if (!settings.openaiApiKey) throw new Error("OpenAI API key is not set in settings.");
  const system = settings.rankingPrompt || DEFAULT_SETTINGS.rankingPrompt;

  const MAX_LEN = 240;
  const payload = {
    priorities_text: prioritiesText || "",
    tasks: tasks.map((t) => ({
      id: t.id,
      note: t.note,
      text: (t.text ?? "").slice(0, MAX_LEN),
      context: t.context ?? null,
      created: t.created ?? null,
      status: t.status ?? "open",
    })),
    max_tasks: n,
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${settings.openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: settings.model || "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(payload) },
      ],
    }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`OpenAI error ${res.status}: ${txt || res.statusText}`);
  }

  const json = await res.json();
  const content: string = json?.choices?.[0]?.message?.content ?? "";
  let obj: any;
  try {
    obj = JSON.parse(content);
  } catch {
    const cleaned = content.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/i, "").trim();
    obj = JSON.parse(cleaned);
  }

  const ids: string[] = Array.isArray(obj?.ranked_task_ids)
    ? obj.ranked_task_ids.map((x: unknown) => String(x))
    : [];

  const allowed = new Set(tasks.map((t) => t.id));
  return ids.filter((id) => allowed.has(id)).slice(0, n);
}

export default class AiTaskPickerPlugin extends Plugin {
  settings: AiTaskPickerSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.addSettingTab(new AiTaskPickerSettingTab(this.app, this));

    this.addCommand({
      id: "insert-ranked-tasks-at-cursor",
      name: "AI: Insert ranked tasks at cursor",
      editorCallback: async (editor: Editor, view: MarkdownView | null) => {
        try {
          if (!view?.file) {
            new Notice("Open a note first.");
            return;
          }

          const nStr = await this.app.workspace.prompt?.("How many tasks should I surface?", "5");
          const n = Math.max(1, parseInt((nStr ?? "5"), 10) || 5);

          new Notice("Collecting tasks…");
          const tasks = await collectAllOpenTasks(this.app, this.settings.folders);

          new Notice("Reading priorities…");
          const priorities = await extractPrioritiesFromActiveNote(this.app, this.settings.prioritiesHeading);

          new Notice("Ranking with OpenAI…");
          const rankedIds = await callOpenAIRank(this.settings, priorities, tasks, n);

          const byId = new Map<string, TaskItem>(tasks.map((t) => [t.id, t]));
          const lines: string[] = [];
          for (const id of rankedIds) {
            const t = byId.get(id);
            if (t) lines.push(`![[${t.note}#^${t.id}]]`);
          }
          if (lines.length === 0) {
            new Notice("No tasks returned.");
            return;
          }

          const text = lines.join("\n") + "\n";
          editor.replaceSelection(text);
          new Notice("Inserted ranked task embeds ✅");
        } catch (e: any) {
          console.error(e);
          new Notice(`AI Task Picker error: ${e?.message ?? e}`);
        }
      },
    });
  }

  async onunload(): Promise<void> {}

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
