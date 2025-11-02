# AI Task Picker (TypeScript, Obsidian Plugin)

Collect open tasks from configured folders, read priorities from a heading in your current note, rank with OpenAI, and insert **inline task embeds** at the cursor so you can check them off (Tasks plugin compatible).

## Features
- Directories to scan (settings)
- Priorities heading to parse in the active note (settings)
- OpenAI key & model (settings)
- **Configurable ranking prompt** (system prompt)
- Command: **AI: Insert ranked tasks at cursor**

## Local Development
1. Extract this folder somewhere outside your vault.
2. Run:
   ```bash
   npm install
   npm run dev
   ```
3. In Obsidian → Settings → Community plugins → **Load unpacked plugin** and select this folder.
4. Configure Settings → **AI Task Picker** (folders, heading, API key, model, prompt).
5. Open your daily note, place the cursor, and run the command:
   **AI: Insert ranked tasks at cursor**.

## Build
```bash
npm run build
```
This produces `main.js` at the repo root. For packaging:
```bash
npm run zip
```
Creates `dist/ai-task-picker.zip` with the files expected by Obsidian.

## Notes
- The plugin auto-assigns block IDs (e.g., `^t-xyz123`) to open tasks lacking an ID.
- Created date detection supports `created:: YYYY-MM-DD` and `➕ YYYY-MM-DD`.
- The priorities heading matcher tolerates emojis/parentheses and normalizes text.
