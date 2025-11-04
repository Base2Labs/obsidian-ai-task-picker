import { TaskItem } from "./types";
import { AiTaskPickerSettings, DEFAULT_SETTINGS } from "./settings";

export async function callOpenAIRank(
  settings: AiTaskPickerSettings,
  prioritiesText: string,
  tasks: TaskItem[],
  maxTasks: number
): Promise<string[]> {
  const apiKey = settings.openaiApiKey || "";
  if (!apiKey) throw new Error("OpenAI API key is not set.");

  const systemPrompt = settings.rankingPrompt || DEFAULT_SETTINGS.rankingPrompt;
  const model = settings.model || "gpt-4o-mini";

  const payload = {
    priorities_text: prioritiesText ?? "",
    tasks,
    max_tasks: maxTasks,
  };

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(payload) },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(errorText || `OpenAI error ${response.status}`);
  }

  const json = await response.json().catch(() => null);
  const content = json?.choices?.[0]?.message?.content ?? "";
  let parsed: any = {};
  try {
    parsed = JSON.parse(
      content.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/i, "").trim()
    );
  } catch {
    // Ignore parse errors
  }

  const rankedIds: string[] = Array.isArray(parsed?.ranked_task_ids)
    ? parsed.ranked_task_ids.map((id: unknown) => String(id))
    : [];

  return rankedIds.slice(0, Math.max(0, maxTasks | 0));
}
