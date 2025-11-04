import { App, TFile } from "obsidian";

function normalizeHeadingText(text: string): string {
  return (text ?? "")
    .replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\p{Symbol}\s]+/gu, "")
    .replace(/\(.+?\)\s*$/g, "")
    .replace(/\+/g, " plus ")
    .replace(/[''`"]/g, "")
    .replace(/[.:•\-–—]/g, " ")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function isHorizontalRule(line: string): boolean {
  return /^\s*([-*_])\1{2,}\s*$/.test(line ?? "");
}

export async function extractPrioritiesFromFile(
  app: App,
  file: TFile,
  desiredHeading: string
): Promise<string> {
  const content = (await app.vault.read(file)) ?? "";
  const lines = content.split(/\r?\n/);

  let start = -1;
  let startDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (!headingMatch) continue;
    const hashes = headingMatch[1] ?? "";
    const headingText = headingMatch[2] ?? "";
    if (
      normalizeHeadingText(headingText) === normalizeHeadingText(desiredHeading)
    ) {
      start = i;
      startDepth = hashes.length;
      break;
    }
  }

  if (start === -1) return "";

  const buffer: string[] = [];
  let seenNonBlank = false;
  for (let j = start + 1; j < lines.length; j++) {
    const line = lines[j] ?? "";

    if (isHorizontalRule(line)) break;

    const headingMatch = line.match(/^(#{1,6})\s+/);
    if (headingMatch) {
      const hashes = headingMatch[1] ?? "";
      const headingDepth = hashes.length;
      if (headingDepth <= startDepth) break;
    }

    if (!seenNonBlank && line.trim() === "") continue;
    seenNonBlank = true;
    buffer.push(line);
  }

  while (buffer.length > 0 && (buffer[buffer.length - 1] ?? "").trim() === "") {
    buffer.pop();
  }

  return buffer.join("\n");
}
