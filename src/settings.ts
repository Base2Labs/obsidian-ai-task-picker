import { App, PluginSettingTab, Setting } from "obsidian";

export interface AiTaskPickerSettings {
  folders: string[];
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
  plugin: any;

  constructor(app: App, plugin: any) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "AI Task Picker Settings" });

    new Setting(containerEl)
      .setName("Folders to scan")
      .setDesc("One path per line (e.g., Daily Notes, 1 Projects).")
      .addTextArea((ta) => {
        ta.setValue(this.plugin.settings.folders.join("\n"))
          .onChange(async (v) => {
            this.plugin.settings.folders = v
              .split("\n")
              .map((s: string) => s.trim())
              .filter(Boolean);
            await this.plugin.saveSettings();
          });
        ta.inputEl.rows = 4;
      });

    new Setting(containerEl)
      .setName("Priorities heading")
      .setDesc("The section heading in the active note to read priorities from.")
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
      .setDesc("Stored locally in this vault's config.")
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
      .setDesc("Example: gpt-4o-mini")
      .addText((t) =>
        t
          .setPlaceholder("gpt-4o-mini")
          .setValue(this.plugin.settings.model)
          .onChange(async (v) => {
            this.plugin.settings.model = v.trim() || "gpt-4o-mini";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Ranking Prompt (System)")
      .setDesc("Customize the system prompt used to rank tasks. Clear to reset to default.")
      .addTextArea((ta) => {
        ta.setValue(this.plugin.settings.rankingPrompt)
          .onChange(async (v) => {
            this.plugin.settings.rankingPrompt = v.trim() || DEFAULT_SETTINGS.rankingPrompt;
            await this.plugin.saveSettings();
          });
        ta.inputEl.rows = 8;
        ta.inputEl.style.fontFamily = "var(--font-monospace)";
      });
  }
}
