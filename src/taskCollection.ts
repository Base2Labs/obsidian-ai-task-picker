import { App, TFile } from "obsidian";
import { TaskItem } from "./types";
import { AiTaskPickerSettings } from "./settings";
import { findTasksPlugin, resolveTasksApi } from "./tasksPlugin";
import { isCompletedTask, formatCreatedDate } from "./taskFilters";
import { ensureBlockIdInBackgroundFile } from "./blockId";
import { normalizeBlockId, ensureMd } from "./utils";

export async function collectOpenTasksViaTasksPlugin(
  app: App,
  settings: AiTaskPickerSettings,
  activeFile: TFile | null
): Promise<TaskItem[]> {
  const tasksPlugin = findTasksPlugin(app);
  const tasksApi = resolveTasksApi(tasksPlugin);
  if (!tasksPlugin || !tasksApi) {
    throw new Error("Tasks plugin missing or incompatible.");
  }

  const allTasks = await tasksApi.getAllTasks();
  const tasksArray: any[] = Array.isArray(allTasks) ? allTasks : [];

  const folderRoots = (settings.folders ?? [])
    .map((folderPath) =>
      (folderPath ?? "").trim().replace(/^\/+|\/+$/g, "")
    )
    .filter((folderPath) => folderPath.length > 0);

  const isInConfiguredFolders = (taskPath: string) => {
    if (folderRoots.length === 0) return true;
    return folderRoots.some(
      (root) => taskPath === root || taskPath.startsWith(root + "/")
    );
  };

  const activeFilePath = activeFile?.path ?? null;

  const filteredTasks = tasksArray.filter((task) => {
    const taskPath = String(task?.path ?? "");
    return (
      taskPath &&
      isInConfiguredFolders(taskPath) &&
      taskPath !== activeFilePath
    );
  });

  const openTasks = filteredTasks.filter((task) => !isCompletedTask(task));

  const taskItems: TaskItem[] = [];
  for (const task of openTasks) {
    const blockId = await ensureBlockIdInBackgroundFile(app, task, activeFile);
    taskItems.push({
      id: normalizeBlockId(blockId),
      note: ensureMd(String(task.path)),
      text: String(task?.description ?? "").trim(),
      context:
        (task?.parent?.headingText ?? task?.parent?.heading ?? null) as
          | string
          | null,
      created: formatCreatedDate(task),
      status: "open",
    });
  }

  return taskItems;
}
