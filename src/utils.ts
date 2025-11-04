export function normalizeBlockId(raw: unknown): string {
  return (raw ?? "")
    .toString()
    .trim()
    .replace(/^(\^|\s)+/, "")
    .trim();
}

export function ensureMd(path: string): string {
  return /\.md$/i.test(path) ? path : `${path}.md`;
}
