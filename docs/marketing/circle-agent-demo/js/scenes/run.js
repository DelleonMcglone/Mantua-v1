/**
 * Scene: Sunday 9:00 AM — the agent runs on its own. Tool steps stream
 * in, the trade is simulated against the policy, then placed.
 */
import { h, reveal, tween } from "../util.js";
import { COPY } from "../timeline.js";
import { shell, askText, step, finish, spin } from "./shell.js";

const STEP_GAP = 1.25;
const STEP_RUN = 0.85;

export function run(scene) {
  const { chat, ask } = shell(scene);
  askText(ask, "", false);
  const hd = h("div", "runhd", null, [
    h("span", "tag", "AUTONOMOUS RUN"),
    h("span", "", "Sun 9:00 AM ET · Edge Hunter: NFL Sundays"),
  ]);
  const steps = COPY.runSteps.map(([l, d]) => step(l, d));
  const result = h("div", "result", null, [
    h("div", "t", null, [h("span", "", "✓"), h("span", "", "Trade placed under your policy")]),
    h("div", "m", "KC YES · $10.00 → 17.1 YES at 58.4% · tx 0x3f8c…a91c · $15.00 cap left today"),
  ]);
  const text = h(
    "div",
    "bubble-a",
    "Edge confirmed and sized to your cap. I will mark the position live and brief you after the game.",
  );
  chat.append(hd, ...steps, result, text);

  const first = 0.9;
  const resultAt = first + COPY.runSteps.length * STEP_GAP + 0.2;

  return (t) => {
    reveal(hd, tween(t, 0.2, 0.6));
    steps.forEach((s, i) => {
      const at = first + i * STEP_GAP;
      s.style.display = t < at ? "none" : "";
      reveal(s, tween(t, at, at + 0.3), 8);
      finish(s, t >= at + STEP_RUN);
      spin(s, t);
    });
    result.style.display = t < resultAt ? "none" : "";
    reveal(result, tween(t, resultAt, resultAt + 0.5), 12);
    text.style.display = t < resultAt + 0.7 ? "none" : "";
    reveal(text, tween(t, resultAt + 0.7, resultAt + 1.1));
  };
}
