import { Editor, MarkdownView, Notice, Plugin, TFile } from "obsidian";
import type { MarkdownFileInfo } from "obsidian";
import {
  AiTaskPickerSettings,
  DEFAULT_SETTINGS,
  AiTaskPickerSettingTab,
} from "./settings";
import { TaskItem } from "./types";
import { normalizeBlockId, ensureMd } from "./utils";
import { warn, error } from "./logger";
import { insertTextAtCursor } from "./editor";
import { promptForCount } from "./modal";
import { extractPrioritiesFromFile } from "./priorities";
import { collectOpenTasksViaTasksPlugin } from "./taskCollection";
import { callOpenAIRank } from "./openai";

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