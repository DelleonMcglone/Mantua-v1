/**
 * Scene: the user clicks the "Daily Brief" chip; the agent assembles the
 * brief, renders the Daily Brief card and narrates the edge.
 */
import { h, reveal, tween, typed, easeInOut, mix } from "../util.js";
import { COPY } from "../timeline.js";
import { shell, askText, row, step, finish, spin, assistant, centerOf } from "./shell.js";

const CHIPS = [
  "Create / Manage Agent",
  "Daily Brief",
  "Today's NFL markets",
  "Recommend a bet",
  "My positions",
  "Hedge my exposure",
];

export function brief(scene) {
  const { chat, ask } = shell(scene);
  askText(ask, "", false);

  const chips = CHIPS.map((c) => h("span", "chip", c));
  const empty = h("div", "empty", null, [
    h("div", "t", "What should your agent do? Pick one or ask in your own words."),
    h("div", "chips", null, chips),
  ]);
  const target = chips[1];

  const msgs = h("div", "empty");
  msgs.style.gap = "14px";
  const user = h("div", "bubble-u", COPY.briefPrompt);
  const st = step("Assembling the brief");
  const rows = COPY.briefRows.map(([l, v]) => row(l, v));
  const mrows = COPY.briefMarkets.map(([l, v]) => row(l, v));
  const mhd = h("div", "hd", "Markets worth a look");
  mhd.style.marginTop = "8px";
  const card = h("div", "card", null, [h("div", "hd", "Daily Brief"), ...rows, mhd, ...mrows]);
  const text = h("div", "bubble-a");
  msgs.append(user, st, card, text);
  chat.append(empty, msgs);

  return (t, ctx) => {
    // Cursor travels to the chip, clicks at 2.0s.
    const from = { x: 980, y: 640 };
    const to = centerOf(target);
    const p = tween(t, 0.8, 1.9, easeInOut);
    const clicked = t >= 2.0;
    ctx.cursor(mix(from.x, to.x, p), mix(from.y, to.y, p), t > 0.5 && t < 2.6);
    target.classList.toggle("hot", clicked && t < 2.35);

    empty.style.display = t < 2.3 ? "" : "none";
    msgs.style.display = t < 2.3 ? "none" : "";
    reveal(user, tween(t, 2.3, 2.7));

    st.style.display = t < 2.9 ? "none" : "";
    finish(st, t >= 4.0);
    spin(st, t);

    card.style.display = t < 4.1 ? "none" : "";
    reveal(card, tween(t, 4.1, 4.5));
    rows.forEach((r, i) => reveal(r, tween(t, 4.3 + i * 0.25, 4.7 + i * 0.25), 8));
    reveal(mhd, tween(t, 5.5, 5.8), 6);
    mrows.forEach((r, i) => reveal(r, tween(t, 5.6 + i * 0.25, 6.0 + i * 0.25), 8));

    text.style.display = t < 6.3 ? "none" : "";
    const shown = typed(COPY.briefText, t, 6.3, 56);
    assistant(text, shown, shown.length < COPY.briefText.length);
  };
}
