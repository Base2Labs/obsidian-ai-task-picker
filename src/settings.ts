import { App, PluginSettingTab, Setting } from "obsidian";

export interface AiTaskPickerSettings {
  folders: string[];          // whitelist (prefix match) for task paths
  openaiApiKey: string;
  model: string;
  prioritiesHeading: string;
  rankingPrompt: string;
}

export const DEFAULT_SETTINGS: AiTaskPickerSettings = {
  folders: ["Daily Notes", "1 Projects"],
  openaiApiKey: "",
  model: "gpt-4o-mini",
  prioritiesHeading: "🎯 Next Week's Priorities",
  rankingPrompt: [
    "You are my executive assistant. Rank my tasks against the supplied priorities.",
    "",
    "Constraints:",
    "- Return STRICT JSON: { \"ranked_task_ids\": [\"id1\", \"id2\", ...] }",
    "- Only include ids that exist in the provided tasks array.",
    "- Prefer tasks that advance the stated priorities.",
    "- Balance urgency (older created dates), unblockers, external visibility / consequence of delay.",
    "- Avoid picking near-duplicates unless they are different concrete steps.",
    "",
    "Output must be valid JSON only. No commentary."
  ].join("\n"),
};

export class AiTaskPickerSettingTab extends PluginSettingTab {
  plugin: { settings: AiTaskPickerSettings; saveSettings: () => Promise<void> };

  constructor(app: App, plugin: any) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "AI Task Picker Settings" });

    // Overview description
    const intro = containerEl.createDiv();
    intro.style.marginBottom = "1.5em";
    intro.style.lineHeight = "1.6";
    intro.createEl("p", { 
      text: "This plugin ranks tasks from the Obsidian Tasks plugin using OpenAI, based on your priorities. Configure the folders to scan, the heading to extract priorities from, and customize the AI ranking behavior."
    });

    new Setting(containerEl)
      .setName("Folders to scan")
      .setDesc("Specify which folders contain tasks to rank. Enter one folder path per line (prefix matching). The plugin will search these folders and their subfolders for tasks. The active note is always excluded to prevent self-references.\n\nExample:\nDaily Notes\n1 Projects\n3 Areas/Work")
      .addTextArea((ta) => {
        ta.setValue(this.plugin.settings.folders.join("\n"))
          .onChange(async (v) => {
            this.plugin.settings.folders = v
              .split("\n")
              .map((s) => s.trim().replace(/^\/+|\/+$/g, ""))
              .filter(Boolean);
            await this.plugin.saveSettings();
          });
        ta.inputEl.rows = 4;
      });

    new Setting(containerEl)
      .setName("Priorities heading")
      .setDesc("The heading in your active note where you've written your current priorities. The plugin will extract the content under this heading and send it to OpenAI to guide task ranking. Supports emojis and punctuation variations.\n\nExample: 🎯 Next Week's Priorities")
      .addText((t) =>
        t
          .setPlaceholder("🎯 Next Week's Priorities")
          .setValue(this.plugin.settings.prioritiesHeading)
          .onChange(async (v) => {
            this.plugin.settings.prioritiesHeading = v.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("OpenAI API Key")
      .setDesc("Your OpenAI API key for task ranking. Get one at platform.openai.com/api-keys. This key is stored locally in your vault's plugin configuration and is never sent anywhere except directly to OpenAI's API.")
      .addText((t) =>
        t
          .setPlaceholder("sk-...")
          .setValue(this.plugin.settings.openaiApiKey)
          .onChange(async (v) => {
            this.plugin.settings.openaiApiKey = v.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("OpenAI Model")
      .setDesc("The OpenAI model to use for ranking. Recommended: gpt-4o-mini (fast and cost-effective) or gpt-4o (more capable). See platform.openai.com/docs/models for available models.")
      .addText((t) =>
        t
          .setPlaceholder("gpt-4o-mini")
          .setValue(this.plugin.settings.model)
          .onChange(async (v) => {
            this.plugin.settings.model = (v || "").trim() || "gpt-4o-mini";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Ranking Prompt (System)")
      .setDesc("Customize the system prompt that guides how the AI ranks your tasks. The prompt receives your priorities text and task list, then returns ranked task IDs. Clear this field to reset to the default prompt. Advanced users can modify the ranking logic here.")
      .addTextArea((ta) => {
        ta.setValue(this.plugin.settings.rankingPrompt)
          .onChange(async (v) => {
            this.plugin.settings.rankingPrompt =
              (v || "").trim() || DEFAULT_SETTINGS.rankingPrompt;
            await this.plugin.saveSettings();
          });
        ta.inputEl.rows = 8;
        ta.inputEl.style.fontFamily = "var(--font-monospace)";
      });
  }
}