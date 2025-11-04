const DEBUG = false;

export function warn(...args: unknown[]): void {
  if (DEBUG) console.warn("[ai-task-picker]", ...args);
}

export function error(...args: unknown[]): void {
  console.error("[ai-task-picker]", ...args);
}
