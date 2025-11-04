export type TaskStatus = "open";

export interface TaskItem {
  id: string;
  note: string; // full path (with .md ensured)
  text: string;
  context: string | null;
  created: string | null;
  status: TaskStatus;
}

export interface TasksApi {
  getAllTasks: () => Promise<any[]> | any[];
}
