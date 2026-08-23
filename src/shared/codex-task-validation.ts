import type { CreateCodexTaskInput, ValidationResult } from "./lifecycle-contract.js";

const promptLimit = 4000;
const projectNameLimit = 256;

export function validateCreateCodexTask(value: unknown): ValidationResult<CreateCodexTaskInput> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, errors: ["request must be an object"] };
  }
  const record = value as Record<string, unknown>;
  const errors: string[] = [];
  const unknown = Object.keys(record).filter((key) => key !== "projectName" && key !== "prompt");
  if (unknown.length > 0) errors.push(`unknown fields: ${unknown.join(", ")}`);

  const projectName = typeof record["projectName"] === "string" ? record["projectName"].trim() : "";
  const prompt = typeof record["prompt"] === "string" ? record["prompt"].trim() : "";
  if (!projectName) errors.push("projectName is required");
  else if (projectName === "all") errors.push("select a concrete project");
  else if (projectName.length > projectNameLimit) errors.push(`projectName must be at most ${projectNameLimit} characters`);
  if (!prompt) errors.push("prompt is required");
  else if (prompt.length > promptLimit) errors.push(`prompt must be at most ${promptLimit} characters`);

  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, value: { projectName, prompt } };
}
