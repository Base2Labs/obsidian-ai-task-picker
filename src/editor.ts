import { Editor, EditorPosition } from "obsidian";

export function insertTextAtCursor(
  editor: Editor,
  cursorPosition: EditorPosition,
  text: string
): void {
  const lineCount = editor.lineCount();
  const validatedLine = Math.min(Math.max(0, cursorPosition.line), lineCount - 1);
  const lineLength = editor.getLine(validatedLine).length;
  const validatedChar = Math.min(Math.max(0, cursorPosition.ch), lineLength);

  const insertPosition: EditorPosition = { line: validatedLine, ch: validatedChar };
  editor.replaceRange(text, insertPosition);

  // Move cursor to end of inserted content and center on screen
  const insertedLines = text.split("\n");
  const endLine = validatedLine + insertedLines.length - 1;
  const lastLine = insertedLines[insertedLines.length - 1] ?? "";
  const endChar =
    insertedLines.length === 1 ? validatedChar + text.length : lastLine.length;
  const endPosition: EditorPosition = { line: endLine, ch: endChar };

  editor.setCursor(endPosition);
  editor.scrollIntoView({ from: endPosition, to: endPosition }, true);
}
