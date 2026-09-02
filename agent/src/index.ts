/**
 * Entry point — builds the Base agent's action registry and prints the
 * registered actions. Confirms the wallet/network layer + action providers
 * load against the configured env. Wire this registry into an LLM tool loop
 * (enumerate getActions(), dispatch invoke(args)) as the next step.
 */
import { createBaseAgentKit } from "./agent.ts";

function main(): void {
  const agentkit = createBaseAgentKit();
  const actions = agentkit.getActions();
  console.log(`Base agent ready — ${String(actions.length)} actions registered:`);
  for (const action of actions) {
    console.log(`  • ${action.name}`);
  }
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
