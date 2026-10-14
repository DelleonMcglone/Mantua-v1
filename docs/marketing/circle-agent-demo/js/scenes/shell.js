/**
 * The Mantua app shell used by every in-app scene: top bar, the
 * "Your Sports Agent" panel with its wallet strip, the global Ask bar
 * and the disclaimer. Also the small DOM helpers the chat scenes share.
 */
import { h } from "../util.js";
import { COPY } from "../timeline.js";

/** Build the shell inside `scene`; returns the chat column and the Ask bar. */
export function shell(scene) {
  scene.classList.add("app");
  const mark = h("img");
  mark.src = "assets/mantua-mark.svg";
  const nav = h("div", "nav", null, [
    h("span", "", "Markets"),
    h("span", "on", "Agent"),
    h("span", "", "Portfolio"),
    h("span", "", "Analytics"),
  ]);
  const net = h("div", "net", null, [
    h("span", "dot"),
    h("span", "", "Arc Mainnet · gas sponsored"),
  ]);
  scene.append(h("div", "topbar", null, [mark, h("span", "brand", "Mantua"), nav, net]));

  const head = h("div", "panel-h", null, [
    h("span", "ico", "◎"),
    h("span", "", "Your Sports Agent"),
  ]);
  const wallet = h("div", "wallet");
  wallet.innerHTML =
    "<span>Agent wallet <b>0x7a3e…c41d</b></span><span>USDC <b>$212.40</b></span>" +
    "<span>Daily cap <b>$25.00</b></span><span class='ok'>● policy active</span>";
  const chat = h("div", "chat");
  scene.append(h("div", "panel", null, [head, wallet, chat]));

  const ask = h("div", "ask", null, [h("span", "txt"), h("span", "send", "↑")]);
  scene.append(ask);
  scene.append(h("div", "foot", COPY.disclaimer));
  return { chat, ask };
}

/** Set the Ask bar's text; empty shows the placeholder. */
export function askText(ask, text, focused, caret = false) {
  const txt = ask.querySelector(".txt");
  txt.replaceChildren();
  if (text) {
    txt.append(document.createTextNode(text));
    if (caret) txt.append(h("span", "caret"));
  } else {
    txt.append(h("span", "ph", "Ask Mantua — a game, a market, your agent…"));
  }
  ask.classList.toggle("focus", focused);
}

/** A label / value row for a card. */
export function row(label, value) {
  const v = h("span", "v");
  v.innerHTML = value.replace(/\+\$[\d.]+/g, (m) => `<span class="up">${m}</span>`);
  return h("div", "row", null, [h("span", "l", label), v]);
}

/** A tool step line: spinner while running, a check when done. */
export function step(label, detail) {
  const el = h("div", "step", null, [h("span", "spin"), h("span", "lbl", label)]);
  el.dataset.label = label;
  el.dataset.detail = detail ?? "";
  return el;
}

/** Flip a step to its finished state (idempotent). */
export function finish(el, done) {
  const first = el.firstElementChild;
  if (done && !first.classList.contains("done")) {
    const check = h("span", "done", "✓");
    first.replaceWith(check);
    el.querySelector(".lbl").textContent = el.dataset.detail
      ? `${el.dataset.label} · ${el.dataset.detail}`
      : el.dataset.label;
  } else if (!done && first.classList.contains("done")) {
    first.replaceWith(h("span", "spin"));
    el.querySelector(".lbl").textContent = el.dataset.label;
  }
}

/** Keep a spinner turning for a seek-driven frame. */
export function spin(el, t) {
  const s = el.querySelector(".spin");
  if (s) s.style.transform = `rotate(${String((t * 360) % 360)}deg)`;
}

/** Assistant text with a live caret while still streaming. */
export function assistant(el, text, streaming) {
  el.replaceChildren(document.createTextNode(text));
  if (streaming) el.append(h("span", "caret"));
}

/** Center of `el` in stage coordinates, for the cursor. */
export function centerOf(el) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}
