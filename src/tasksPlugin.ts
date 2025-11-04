import { App } from "obsidian";
import { TasksApi } from "./types";
import { warn } from "./logger";

export function findTasksPlugin(app: App): any | null {
  const pluginManager: any = (app as any).plugins;
  const pluginMap: Record<string, any> = pluginManager?.plugins
    ? pluginManager.plugins
    : {};

  if (pluginMap["obsidian-tasks-plugin"]) {
    return pluginMap["obsidian-tasks-plugin"];
  }

  const foundPlugin = Object.values(pluginMap).find((plugin: any) => {
    const pluginId = (plugin?.manifest?.id ?? "").toLowerCase();
    const pluginName = (plugin?.manifest?.name ?? "").toLowerCase();
    return pluginId.includes("tasks") || pluginName.includes("tasks");
  });

  return foundPlugin ?? null;
}

export function resolveTasksApi(plugin: any): TasksApi | null {
  if (!plugin) return null;

  const directApi = plugin?.api;
  if (directApi?.getTasks) {
    return { getAllTasks: () => directApi.getTasks() };
  }

  if (typeof plugin?.getAPI === "function") {
    const factoryApi = plugin.getAPI();
    if (factoryApi?.getTasks) {
      return { getAllTasks: () => factoryApi.getTasks() };
    }
  }

  const legacyApi = directApi?.v1 ?? plugin?.v1 ?? plugin?.apiV1;
  if (legacyApi?.tasks?.getTasks) {
    return { getAllTasks: () => legacyApi.tasks.getTasks() };
  }
  if (legacyApi?.getTasks) {
    return { getAllTasks: () => legacyApi.getTasks() };
  }

  if (typeof plugin?.getTasks === "function") {
    return { getAllTasks: () => plugin.getTasks() };
  }

  warn("No known Tasks API shape found", plugin);
  return null;
}
