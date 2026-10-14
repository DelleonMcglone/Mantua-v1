/**
 * Full-bleed "text spot" scenes on the nebula art: the opening title,
 * the three chapter cards and the closing wordmark. The art pans slowly
 * (background-position) between the scene's `pan` stops.
 */
import { h, reveal, tween, easeInOut, mix } from "../util.js";

function pan(scene, cfg, t, dur) {
  const p = tween(t, 0, dur, easeInOut);
  scene.style.backgroundPosition = `center ${String(mix(cfg.pan[0], cfg.pan[1], p))}%`;
}

/** Title card: eyebrow, headline (with an optional gradient word) and sub. */
export function title(scene, cfg) {
  scene.classList.add("art");
  const eyebrow = h("div", "eyebrow", cfg.eyebrow);
  const ttl = h("div", "title");
  const [lead, ...rest] = cfg.title.split(cfg.accent ?? "\u0000");
  ttl.append(document.createTextNode(lead));
  if (rest.length)
    ttl.append(h("span", "grad", cfg.accent), document.createTextNode(rest.join("")));
  const sub = h("div", "sub", cfg.sub);
  scene.append(h("div", "center", null, [eyebrow, ttl, sub]));
  const dur = cfg.to - cfg.from;
  return (t) => {
    pan(scene, cfg, t, dur);
    reveal(eyebrow, tween(t, 0.15, 0.75));
    reveal(ttl, tween(t, 0.35, 1.1), 22);
    reveal(sub, tween(t, 0.7, 1.4));
  };
}

/** Chapter strip: "< label >" in a framed, striped band. */
export function chapter(scene, cfg) {
  scene.classList.add("art");
  const label = h("div", "label", null, [
    h("span", "chev", "<"),
    h("span", "", cfg.label),
    h("span", "chev", ">"),
  ]);
  const card = h("div", "chapter", null, [h("div", "bars"), label]);
  for (const [cls, st] of [
    ["tl", "left:-1px;top:-1px;border-width:1px 0 0 1px"],
    ["tr", "right:-1px;top:-1px;border-width:1px 1px 0 0"],
    ["bl", "left:-1px;bottom:-1px;border-width:0 0 1px 1px"],
    ["br", "right:-1px;bottom:-1px;border-width:0 1px 1px 0"],
  ]) {
    const c = h("span", `corner ${cls}`);
    c.style.cssText = st;
    card.append(c);
  }
  scene.append(h("div", "center", null, [card]));
  const dur = cfg.to - cfg.from;
  return (t) => {
    pan(scene, cfg, t, dur);
    const p = tween(t, 0.1, 0.8);
    card.style.opacity = String(p);
    card.style.transform = `scale(${String(mix(0.94, 1, p))})`;
    reveal(label, tween(t, 0.35, 0.95), 10);
  };
}

/** Outro: "only at" + the Mantua.AI wordmark. */
export function outro(scene, cfg) {
  scene.classList.add("art");
  const only = h("div", "eyebrow", "only at");
  only.style.color = "#efeaff";
  const mark = h("img");
  mark.src = "assets/mantua-mark.svg";
  const name = h("div", "name", null, [
    document.createTextNode("Mantua"),
    h("span", "grad", ".AI"),
  ]);
  const wm = h("div", "wordmark", null, [mark, name]);
  const tag = h("div", "tagline", "Agent-native prediction markets for sports");
  scene.append(h("div", "center", null, [only, wm, tag]));
  const dur = cfg.to - cfg.from;
  return (t) => {
    pan(scene, cfg, t, dur);
    reveal(only, tween(t, 0.1, 0.7));
    const p = tween(t, 0.3, 1.2);
    wm.style.opacity = String(p);
    wm.style.transform = `scale(${String(mix(0.92, 1, p))})`;
    reveal(tag, tween(t, 1.0, 1.7));
  };
}
