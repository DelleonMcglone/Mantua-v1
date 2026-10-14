/**
 * Mounts the storyboard and exposes `window.seek(t)` so a renderer can
 * draw any frame. Without a driver it plays back in real time.
 */
import { SCENES, DURATION } from "./timeline.js";
import { window01, h } from "./util.js";
import { title, chapter, outro } from "./scenes/art.js";
import { brief } from "./scenes/brief.js";
import { create } from "./scenes/create.js";
import { live } from "./scenes/live.js";
import { run } from "./scenes/run.js";

const BUILDERS = { title, chapter, outro, brief, create, live, run };
const FADE = 0.4;

const stage = document.getElementById("stage");
const cursor = document.getElementById("cursor");
let cursorState = { x: 0, y: 0, on: false };
const ctx = {
  cursor: (x, y, on) => {
    cursorState = { x, y, on };
  },
};

const mounted = SCENES.map((cfg) => {
  const el = h("div", "scene");
  stage.append(el);
  return { cfg, el, update: BUILDERS[cfg.type](el, cfg) };
});

/** Render the frame at absolute time `t` (seconds). */
export function seek(t) {
  cursorState = { ...cursorState, on: false };
  for (const { cfg, el, update } of mounted) {
    const a = window01(t, cfg.from, cfg.from + FADE, cfg.to - FADE, cfg.to);
    el.style.opacity = String(a);
    el.style.display = a > 0 ? "" : "none";
    if (a > 0) update(t - cfg.from, ctx);
  }
  cursor.style.opacity = cursorState.on ? "1" : "0";
  cursor.style.transform = `translate(${String(cursorState.x)}px, ${String(cursorState.y)}px)`;
}

window.seek = seek;
window.DURATION = DURATION;

document.fonts.ready.then(() => {
  seek(0);
  window.__ready = true;
  if (window.__driven) return;
  const start = performance.now();
  const loop = () => {
    seek(((performance.now() - start) / 1000) % DURATION);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
});
