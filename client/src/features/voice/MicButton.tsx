/**
 * Task 069 (V-002) — the push-to-talk control.
 *
 * Hold to speak, release to send. There is no toggle and no wake word:
 * the microphone is open exactly while a finger or a key is down, which is
 * both the clearest contract for the user and most of the answer to
 * accidental activation (V-007).
 *
 * Keyboard users hold the space bar or enter while the button has focus,
 * so the control is not a mouse-only feature.
 */
import { Mic } from "lucide-react";
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
        onPress();
      }}
      onPointerUp={onRelease}
      onPointerLeave={() => {
        if (live) onRelease();
      }}
      onKeyDown={(e) => {
        if (e.repeat) return;
        if (e.key === " " || e.key === "Enter") onPress();
      }}
      onKeyUp={(e) => {
        if (e.key === " " || e.key === "Enter") onRelease();
      }}
      className={[
        "bg-transparent border-none cursor-pointer flex p-1 disabled:cursor-not-allowed",
        live ? "text-accent" : "text-text-dim",
        disabled ? "opacity-40" : "",
      ].join(" ")}
    >
      <Mic className={`h-4 w-4 ${live ? "animate-pulse" : ""}`} />
    </button>
  );
}
