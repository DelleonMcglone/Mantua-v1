/**
 * Task 069 (V-002) — the push-to-talk control.
 *
 * Hold to speak, release to send. There is no toggle and no wake word:
 * the microphone is open exactly while a finger or a key is down, which is
 * both the clearest contract for the user and most of the answer to
 * accidental activation (V-007).
 *
 * Task 071 (MX-005) tunes the hold for a thumb: the press captures the
 * pointer so a finger drifting off the button keeps recording, the long-
 * press context menu and text selection are suppressed, a cancelled
 * gesture or a hidden page releases, the target is 44 px on phones, and
 * Android gets a short haptic tick on press (press-events.ts).
 *
 * Keyboard users hold the space bar or enter while the button has focus,
 * so the control is not a mouse-only feature.
 */
import { useEffect, useRef } from "react";
import { Mic } from "lucide-react";
import { hapticTick, pressEnds } from "./press-events.ts";
import type { VoicePhase } from "./voice-types.ts";

interface Props {
  phase: VoicePhase;
  onPress: () => void;
  onRelease: () => void;
}

const LABEL: Record<VoicePhase, string> = {
  idle: "Hold to speak",
  starting: "Starting the microphone",
  listening: "Listening — release to send",
  settling: "Finishing up",
  unavailable: "Voice unavailable",
};

export function MicButton({ phase, onPress, onRelease }: Props) {
  const live = phase === "listening" || phase === "starting";
  const disabled = phase === "unavailable";
  const captured = useRef(false);

  // A phone call, an app switch, or the screen locking: release.
  useEffect(() => {
    if (!live) return;
    const hidden = () => {
      if (document.visibilityState === "hidden" && pressEnds("hidden", captured.current))
        onRelease();
    };
    const blur = () => {
      if (pressEnds("blur", captured.current)) onRelease();
    };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("blur", blur);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("blur", blur);
    };
  }, [live, onRelease]);

  const end = (reason: "pointerup" | "pointercancel" | "pointerleave") => {
    if (!live || !pressEnds(reason, captured.current)) return;
    captured.current = false;
    onRelease();
  };

  return (
    <button
      type="button"
      disabled={disabled}
      data-testid="mic"
      data-phase={phase}
      aria-label={LABEL[phase]}
      title={LABEL[phase]}
      onPointerDown={(e) => {
        e.preventDefault();
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
          captured.current = true;
        } catch {
          captured.current = false;
        }
        if (e.pointerType === "touch") hapticTick(navigator);
        onPress();
      }}
      onPointerUp={() => {
        end("pointerup");
      }}
      onPointerCancel={() => {
        end("pointercancel");
      }}
      onPointerLeave={() => {
        end("pointerleave");
      }}
      onContextMenu={(e) => {
        e.preventDefault();
      }}
      onKeyDown={(e) => {
        if (e.repeat) return;
        if (e.key === " " || e.key === "Enter") onPress();
      }}
      onKeyUp={(e) => {
        if (e.key === " " || e.key === "Enter") onRelease();
      }}
      className={[
        "flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-transparent border-none cursor-pointer",
        "select-none [touch-action:none] [-webkit-touch-callout:none] disabled:cursor-not-allowed",
        "md:h-auto md:w-auto md:rounded-none md:p-1",
        live ? "bg-accent/15 text-accent md:bg-transparent" : "text-text-dim",
        disabled ? "opacity-40" : "",
      ].join(" ")}
    >
      <Mic className={`h-5 w-5 md:h-4 md:w-4 ${live ? "animate-pulse" : ""}`} />
    </button>
  );
}
