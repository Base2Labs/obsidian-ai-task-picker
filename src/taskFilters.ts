export function isCompletedTask(task: any): boolean {
  if (!task) return false;

  const status = task.status;
  const statusString =
    (typeof status === "string"
      ? status
      : status?.name ?? status?.type ?? status?.toString?.()) ?? "";
  const normalizedStatus = statusString.toString().toLowerCase();

  const completionPattern = /(done|completed|complete|cancel|🗑|✅|✔|x\b)/i;
  const booleanFlags = [
    task.done,
    task.completed,
    task.isDone,
    status?.done,
    status?.isDone,
  ];
  const completionDates = [
    task.doneDate,
    task.completedDate,
    task.completionDate,
  ];

  return (
    booleanFlags.some((flag) => flag === true) ||
    completionDates.some((date) => !!date) ||
    completionPattern.test(normalizedStatus)
  );
}

export function formatCreatedDate(task: any): string | null {
  if (!task) return null;

  const dateValue: any =
    (task.createdDate &&
      ((task.createdDate as any).date ?? task.createdDate)) ??
    task.created ??
    null;

  try {
    if (!dateValue) return null;

    if (typeof dateValue === "string") {
      return /^\d{4}-\d{2}-\d{2}$/.test(dateValue) ? dateValue : null;
    }

    if (typeof (dateValue as any)?.format === "function") {
      return (dateValue as any).format("YYYY-MM-DD");
    }

    if (
      typeof dateValue === "object" &&
      dateValue.year &&
      dateValue.month &&
      dateValue.day
    ) {
      const month = String(dateValue.month).padStart(2, "0");
      const day = String(dateValue.day).padStart(2, "0");
      return `${dateValue.year}-${month}-${day}`;
    }
  } catch (err) {
    // Silently fail and return null
  }
  return null;
}
