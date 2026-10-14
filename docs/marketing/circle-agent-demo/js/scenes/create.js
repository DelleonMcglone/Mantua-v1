/**
 * Scene: the user types a standing instruction into the Ask bar; the
 * agent turns it into a recurring workflow and offers to activate it.
 */
import { h, reveal, tween, typed, typeDuration, easeInOut, mix } from "../util.js";
import { COPY } from "../timeline.js";
import { shell, askText, assistant, centerOf } from "./shell.js";

const CPS = 32;

export function create(scene) {
  const { chat, ask } = shell(scene);
  chat.style.justifyContent = "flex-end";

  const prev = h("div", "bubble-a", COPY.briefText);
  prev.style.color = "var(--text-dim)";
  const user = h("div", "bubble-u", COPY.createPrompt);
  const reply = h("div", "bubble-a");
  const title = h("div", "wf-title", COPY.workflowTitle);
  const steps = COPY.steps.map(([k, d], i) =>
    h("div", "wstep", null, [
      h("span", "n", String(i + 1)),
      h("div", "box", null, [h("div", "k", k), h("div", "d", d)]),
    ]),
  );
  const activate = h("div", "activate", null, [
    h("span", "", "Activate your Agent"),
    h("span", "", "→"),
  ]);
  chat.append(prev, user, reply, title, ...steps, activate);

  const typeEnd = 0.5 + typeDuration(COPY.createPrompt, CPS);
  const sendAt = typeEnd + 0.35;
  const replyAt = sendAt + 0.4;
  const wfAt = replyAt + 1.2;
  const btnAt = wfAt + 0.4 + COPY.steps.length * 0.6 + 0.3;

  return (t, ctx) => {
    // The Ask bar: focus, type, send, clear.
    const sent = t >= sendAt;
    const text = sent ? "" : typed(COPY.createPrompt, t, 0.5, CPS);
    askText(ask, text, t >= 0.3 && !sent, !sent && t >= 0.3);
    ask.querySelector(".send").style.transform =
      t >= sendAt - 0.1 && t < sendAt + 0.15 ? "scale(0.85)" : "";

    // Once the reply starts, the brief's last line scrolls away.
    prev.style.display = t < replyAt + 0.8 ? "" : "none";
    reveal(prev, 1 - tween(t, replyAt + 0.4, replyAt + 0.8));

    user.style.display = sent ? "" : "none";
    reveal(user, tween(t, sendAt, sendAt + 0.4));

    reply.style.display = t < replyAt ? "none" : "";
    const shown = typed(COPY.createReply, t, replyAt, 48);
    assistant(reply, shown, shown.length < COPY.createReply.length);

    title.style.display = t < wfAt ? "none" : "";
    reveal(title, tween(t, wfAt, wfAt + 0.4));
    steps.forEach((s, i) => {
      const at = wfAt + 0.4 + i * 0.6;
      s.style.display = t < at ? "none" : "";
      reveal(s, tween(t, at, at + 0.4), 12);
      s.classList.toggle("hl", t >= at && t < at + 0.55);
    });

    activate.style.display = t < btnAt ? "none" : "";
    reveal(activate, tween(t, btnAt, btnAt + 0.45), 16);

    // Cursor glides to the button and presses it.
    const from = { x: 1010, y: 660 };
    const to = t >= btnAt ? centerOf(activate) : from;
    const p = tween(t, btnAt + 0.3, btnAt + 1.2, easeInOut);
    const pressed = t >= btnAt + 1.3;
    ctx.cursor(mix(from.x, to.x, p), mix(from.y, to.y, p), t >= btnAt + 0.2);
    activate.classList.toggle("press", pressed && t < btnAt + 1.55);
  };
}
