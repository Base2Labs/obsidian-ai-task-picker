import { App, Modal, Notice } from "obsidian";

export class NumberPromptModal extends Modal {
  private resolve!: (value: number | null) => void;
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
      const taskCount = Number(input.value);
      if (Number.isFinite(taskCount) && taskCount >= 1) {
        this.resolve(Math.floor(taskCount));
        this.close();
      } else {
        new Notice("Please enter a number ≥ 1");
      }
    };

    ok.addEventListener("click", submit);
    cancel.addEventListener("click", () => {
      this.resolve(null);
      this.close();
    });
    input.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") submit();
      if (e.key === "Escape") {
        this.resolve(null);
        this.close();
      }
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }

  prompt(): Promise<number | null> {
    return new Promise((resolve) => {
      this.resolve = resolve;
      this.open();
    });
  }
}

export async function promptForCount(
  app: App,
  initial = 5
): Promise<number | null> {
  const modal = new NumberPromptModal(app, initial);
  return modal.prompt();
}
