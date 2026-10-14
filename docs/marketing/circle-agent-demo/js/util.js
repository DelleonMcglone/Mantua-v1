/**
 * Pure timing helpers for the demo timeline. Every scene derives its
 * state from an absolute time so a frame can be rendered for any `t`.
 */

/** Clamp `x` into [0, 1]. */
export const clamp01 = (x) => Math.min(1, Math.max(0, x));

/** Cubic ease-out — the "settle" used for most reveals. */
export const easeOut = (p) => 1 - Math.pow(1 - p, 3);

/** Cubic ease-in-out — used for cursor travel and background pans. */
export const easeInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

/**
 * Progress of `t` through [t0, t1], eased. Returns 0 before, 1 after.
 * @param {number} t local scene time (s)
 * @param {number} t0 start (s)
 * @param {number} t1 end (s)
 * @param {(p:number)=>number} ease easing applied to the linear progress
 */
export function tween(t, t0, t1, ease = easeOut) {
  if (t1 <= t0) return t >= t1 ? 1 : 0;
  return ease(clamp01((t - t0) / (t1 - t0)));
}

/** Linear interpolation between `a` and `b` by `p`. */
export const mix = (a, b, p) => a + (b - a) * p;

/**
 * Characters of `text` revealed by time `t` when typing starts at `t0`
 * at `cps` characters per second.
 */
export function typed(text, t, t0, cps = 28) {
  const n = Math.floor(Math.max(0, t - t0) * cps);
  return text.slice(0, Math.min(text.length, n));
}

/** Seconds needed to type `text` at `cps`. */
export const typeDuration = (text, cps = 28) => text.length / cps;

/** Apply a fade + rise reveal to `el` at progress `p` (0 hidden → 1 shown). */
export function reveal(el, p, rise = 14) {
  el.style.opacity = String(p);
  el.style.transform = `translateY(${String((1 - p) * rise)}px)`;
}

/** Fade reveal that also fades out between `tOut0` and `tOut1`. */
export function window01(t, tIn0, tIn1, tOut0, tOut1) {
  return Math.min(tween(t, tIn0, tIn1), 1 - tween(t, tOut0, tOut1, easeInOut));
}

/** Build an element with a class and optional text/children. */
export function h(tag, cls, text, children = []) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined && text !== null) el.textContent = text;
  for (const c of children) el.append(c);
  return el;
}
