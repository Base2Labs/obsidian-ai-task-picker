# AI Task Picker

An Obsidian plugin that intelligently ranks your tasks using OpenAI based on your stated priorities. It collects tasks from the [Obsidian Tasks plugin](https://github.com/obsidian-tasks-group/obsidian-tasks), reads your priorities from a heading in the active note, ranks them via OpenAI, and inserts inline task embeds at your cursor position.

## Prerequisites

- **Obsidian Tasks plugin** must be installed and enabled
- **OpenAI API key** (get one at [platform.openai.com/api-keys](https://platform.openai.com/api-keys))

## Features

- 📁 **Folder-based task collection** - Specify which folders to scan for tasks (prefix matching, searches subfolders)
- 🎯 **Priority-driven ranking** - Extracts priorities from a configurable heading in your active note
- 🤖 **OpenAI-powered intelligence** - Uses GPT models to rank tasks against your priorities
- ⚙️ **Customizable ranking logic** - Modify the system prompt to change how tasks are ranked
- 📝 **Inline task embeds** - Inserts `![[note.md#^block-id]]` embeds that remain checkable
- 🔒 **Active file protection** - Never modifies your current note during task collection
- 🏷️ **Auto block IDs** - Automatically generates block IDs for tasks that don't have them

## How It Works

1. **Collect tasks** - Scans configured folders for open tasks (excluding the active note)
2. **Extract priorities** - Reads content under the specified heading in your active note
3. **Rank with AI** - Sends priorities and tasks to OpenAI for intelligent ranking
4. **Insert embeds** - Places the top N ranked tasks as embeds at your cursor position

## Configuration

Access settings via **Settings → AI Task Picker**:

### Folders to Scan
Specify which folders contain tasks to rank. Enter one folder path per line (prefix matching). The plugin will search these folders and their subfolders for tasks.

**Example:**
```
Daily Notes
1 Projects
3 Areas/Work
```

### Priorities Heading
The heading in your active note where you've written your current priorities. The plugin extracts the content under this heading and sends it to OpenAI to guide task ranking. Supports emojis and punctuation variations.

**Example:** `🎯 Next Week's Priorities`

### OpenAI API Key
Your OpenAI API key for task ranking. This key is stored locally in your vault's plugin configuration and is only sent directly to OpenAI's API.

### OpenAI Model
The OpenAI model to use for ranking.
- **Recommended:** `gpt-4o-mini` (fast and cost-effective)
- **Alternative:** `gpt-4o` (more capable, higher cost)
- See [platform.openai.com/docs/models](https://platform.openai.com/docs/models) for available models

### Ranking Prompt (System)
Customize the system prompt that guides how the AI ranks your tasks. The prompt receives your priorities text and task list, then returns ranked task IDs. Advanced users can modify the ranking logic here. Clear this field to reset to the default prompt.

## Usage

1. Open a note with your priorities listed under the configured heading
2. Place your cursor where you want the ranked tasks inserted
3. Run the command: **AI: Insert ranked tasks at cursor**
4. Enter the number of tasks you want to retrieve
5. The plugin will insert task embeds that you can check off directly

## Local Development

1. Extract this folder somewhere outside your vault
2. Install dependencies and start watch mode:
   ```bash
   npm install
   npm run dev
   ```
3. In Obsidian → **Settings → Community plugins → Load unpacked plugin** → select this folder
4. Configure **Settings → AI Task Picker** (folders, heading, API key, model, prompt)
5. Open your daily note, place the cursor, and run: **AI: Insert ranked tasks at cursor**

## Build & Package

### Development build
```bash
npm run build
```
Produces `main.js` at the repo root.

### Create distribution package
```bash
npm run zip
```
Creates `dist/ai-task-picker.zip` containing `main.js`, `manifest.json`, `styles.css`, and `README.md`.

## Technical Details

### Block ID Management
- Auto-generates unique block IDs (e.g., `^t-xyz123`) for tasks missing them
- Only modifies background files (never the active file)
- Waits for Obsidian's metadata cache to index new block IDs
- Ensures task embeds resolve correctly

### Date Detection
Created dates are parsed from task metadata:
- `created:: YYYY-MM-DD` format
- `➕ YYYY-MM-DD` emoji format

### Priority Extraction
- Locates heading by normalized text matching
- Tolerates emojis, parentheses, and punctuation differences
- Extracts content until next same-level heading or horizontal rule

### Safety Mechanisms
- Cursor position saved before async operations
- Active file never modified during task collection
- Document content validation after operations
- Content restoration if unexpected modifications detected

## Known Issues

### Active Note Content Modification During Task Collection
**Issue:** During the task collection process, additional lines are sometimes added to the top of the active note, corrupting its content.

**Workaround:** The plugin currently captures the entire note contents before task collection and restores it after collection is complete, before inserting the ranked tasks. This prevents data loss but is a band-aid solution.

**Root Cause:** Unknown - likely related to Obsidian's metadata cache or the Tasks plugin API triggering unwanted modifications.

**Impact:** Users may notice a brief flash or reversion of their note content during task insertion. No data is lost due to the workaround, but the underlying issue needs investigation.

## License

MIT
