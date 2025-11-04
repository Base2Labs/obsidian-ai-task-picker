# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

AI Task Picker is an **Obsidian plugin** (TypeScript) that integrates with the Obsidian Tasks plugin. It collects open tasks from configured folders, reads user priorities from a heading in the active note, ranks them via OpenAI, and inserts inline task embeds at the cursor position.

**Critical dependencies:**
- Requires `obsidian-tasks-plugin` to be installed and enabled
- Uses OpenAI API for task ranking

## Development Commands

### Setup
```bash
npm install
```

### Development (watch mode)
```bash
npm run dev
```
This runs esbuild in watch mode, outputting `main.js` at the project root.

### Build (production)
```bash
npm run build
```
Produces optimized `main.js` for distribution.

### Packaging
```bash
npm run zip
```
Creates `dist/ai-task-picker.zip` containing `main.js`, `manifest.json`, `styles.css`, and `README.md`.

### Testing in Obsidian
1. Run `npm run dev` to enable watch mode
2. In Obsidian → Settings → Community plugins → **Load unpacked plugin** → select this folder
3. Configure plugin settings (folders, OpenAI key, priorities heading)
4. Open a note, place cursor, run command: **AI: Insert ranked tasks at cursor**

## Architecture

### Core Flow (`src/main.ts`)
The main command (`insert-ranked-tasks-at-cursor`) orchestrates the entire workflow:
1. **Prompt user** for task count via modal
2. **Collect tasks** from configured folders (excluding active file)
3. **Extract priorities** from active note under specified heading
4. **Rank via OpenAI** using customizable system prompt
5. **Insert task embeds** (`![[note.md#^block-id]]`) at saved cursor position

### Key Modules

**Task Collection (`taskCollection.ts`)**
- Interfaces with Obsidian Tasks plugin via compatibility layer (`tasksPlugin.ts`)
- Filters tasks by configured folder prefixes
- Excludes active file to prevent self-references
- Ensures block IDs exist on all tasks

**Block ID Management (`blockId.ts`)**
- Auto-generates unique block IDs (`^t-xyz123`) for tasks missing them
- Modifies background files (never the active file)
- Waits for Obsidian's metadata cache to index new block IDs
- Critical for task embeds to resolve correctly

**Priority Extraction (`priorities.ts`)**
- Locates heading in active note by normalized text matching
- Tolerates emojis, parentheses, punctuation differences
- Extracts content until next same-level heading or horizontal rule

**OpenAI Integration (`openai.ts`)**
- Sends priorities text + task array to GPT model
- Uses structured JSON response format
- Returns ordered list of task block IDs
- Configurable system prompt and model via settings

**Settings (`settings.ts`)**
```typescript
interface AiTaskPickerSettings {
  folders: string[];           // Folder prefixes to scan
  openaiApiKey: string;         // Stored locally in vault
  model: string;                // Default: "gpt-4o-mini"
  prioritiesHeading: string;    // Heading to extract from active note
  rankingPrompt: string;        // System prompt for OpenAI
}
```

### Critical Safety Mechanisms

**Active File Protection**
- Cursor position saved **before** showing modal
- Document content validated after async operations
- Block ID assignment **refuses** to modify active file
- Content restoration if unexpected modifications detected

**Block ID Indexing**
- Generated IDs must be indexed by Obsidian's metadata cache
- Plugin waits up to 2 seconds for cache update
- Skips embeds for unindexed blocks to prevent broken links
- Warns user if indexing times out

### Task Data Flow

```
Tasks Plugin API
    ↓ (getAllTasks)
Filter by folders → Exclude active file → Check completed status
    ↓
Ensure block IDs (modify background files if needed)
    ↓
TaskItem[] { id, note, text, context, created, status }
    ↓
OpenAI ranking (priorities + tasks → ranked IDs)
    ↓
Generate embeds: ![[note.md#^block-id]]
    ↓
Insert at saved cursor position
```

## Important Constraints

### TypeScript Configuration
- Target: ES2020
- Strict mode enabled with `noUncheckedIndexedAccess`
- Module resolution: "bundler"
- External: `obsidian` (provided by Obsidian app)

### Build System
- esbuild bundles `src/main.ts` → `main.js`
- CJS format for Obsidian compatibility
- Manifest.json embedded as banner in output
- No emit from TypeScript compiler (esbuild handles compilation)

### Date Detection
Created dates parsed from task metadata:
- `created:: YYYY-MM-DD` format
- `➕ YYYY-MM-DD` emoji format

### Tasks Plugin Compatibility Layer
`tasksPlugin.ts` handles multiple API shapes:
- Direct `plugin.api.getTasks()`
- Factory pattern `plugin.getAPI().getTasks()`
- Legacy v1 API `plugin.apiV1.tasks.getTasks()`
