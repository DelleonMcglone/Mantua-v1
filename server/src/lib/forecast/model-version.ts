import { createHash } from "node:crypto";

/**
 * The model version stamped on every forecast: a hash of what shaped the
 * probability — the system prompt, the tool definitions, the estimator's
 * weights and the model id. A change to any of them is a new version, so
 * results split by version and history is never rewritten. Pure.
 */
export interface ModelVersionInput {
  model: string;
  prompt: string;
  tools: readonly { name: string; description?: string | undefined }[];
  weights: Record<string, number>;
}

export function hashModelVersion(input: ModelVersionInput): string {
  const h = createHash("sha256");
  h.update(input.model);
  h.update("\n");
  h.update(input.prompt);
  h.update("\n");
  for (const t of [...input.tools].sort((a, b) => a.name.localeCompare(b.name))) {
    h.update(`${t.name}:${t.description ?? ""}\n`);
  }
  for (const k of Object.keys(input.weights).sort()) {
    h.update(`${k}=${String(input.weights[k])}\n`);
  }
  return h.digest("hex").slice(0, 16);
}
