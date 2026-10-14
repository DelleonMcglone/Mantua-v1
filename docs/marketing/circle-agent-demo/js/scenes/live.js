/**
 * Scene: the activated agent as a card — name, cadence, "Live ·
 * Currently running" with a breathing status LED.
 */
import { h, tween, mix } from "../util.js";
import { COPY } from "../timeline.js";

export function live(scene) {
  scene.classList.add("live-bg");
  const mark = h("img", "mark");
  mark.src = "assets/mantua-mark.svg";
  const led = h("span", "led");
  const card = h("div", "live", null, [
    mark,
    h("div", "t", COPY.liveTitle),
    h("div", "d", COPY.liveDesc),
    h("span", "pill", "Trading Strategy"),
    h("hr"),
    h("div", "st", null, [
      h("div", "", null, [h("div", "s", "Live"), h("div", "r", "Currently running")]),
      led,
    ]),
  ]);
  scene.append(card);
  return (t) => {
    const p = tween(t, 0.1, 0.9);
    card.style.opacity = String(p);
    card.style.transform = `translate(-50%, -50%) scale(${String(mix(0.94, 1, p))})`;
    const glow = 8 + 8 * (0.5 + 0.5 * Math.sin(t * 3));
    led.style.boxShadow = `0 0 ${String(glow)}px var(--green)`;
  };
}
