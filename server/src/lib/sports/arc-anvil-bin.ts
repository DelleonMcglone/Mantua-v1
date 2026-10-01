import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * `arc-anvil` from PATH, else where arc-foundry's installer puts it
 * (`~/.local/bin`), so the proof runs from a shell that never added that dir.
 */
export function resolveArcAnvil(): string {
  const dirs = (process.env["PATH"] ?? "").split(":");
  if (dirs.some((d) => d && existsSync(join(d, "arc-anvil")))) return "arc-anvil";
  const local = join(homedir(), ".local", "bin", "arc-anvil");
  return existsSync(local) ? local : "arc-anvil";
}
