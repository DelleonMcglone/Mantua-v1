import { useState } from "react";
import { Send } from "lucide-react";
import { MicButton } from "@/features/voice/MicButton.tsx";
import { transcriptText } from "@/features/voice/transcript-core.ts";
import { useVoiceInput } from "@/features/voice/use-voice-input.ts";

interface Props {
  /** `spoken` marks a transcribed command, which can never confirm (V-009). */
  onSubmit: (text: string, spoken?: boolean) => void;
  /** Logged-out state swaps the placeholder to say login is needed. */
  placeholder?: string | undefined;
}

/**
 * Persistent chat input bar — sits at the bottom of the right-column
 * card and matches prototype `InputBar` in app.jsx. Submits route
 * commands ("swap", "liquidity", "positions") to the parent so the
 * panel can switch routes; free-form text starts a chat conversation.
 *
 * Task 069 (V-002, V-003) adds the microphone beside the send button.
 * Speech fills the field live while the user talks and is submitted
 * through the same `onSubmit` typing uses — there is no second path. The
 * keyboard keeps working throughout, which is the whole of the fallback
 * story when voice fails (V-010).
 */
export function InputBar({ onSubmit, placeholder }: Props) {
  const [value, setValue] = useState("");

  const submit = (text: string, spoken = false) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSubmit(trimmed, spoken);
    setValue("");
  };

  const voice = useVoiceInput((text) => {
    submit(text, true);
  });
  const heard = transcriptText(voice.transcript);
  const speaking = voice.phase === "listening" || voice.phase === "starting";
  const shown = speaking && heard !== "" ? heard : value;

  return (
    <div className="border-t border-border-soft px-3 pt-2.5 pb-[max(12px,env(safe-area-inset-bottom))] md:px-5 md:pt-3.5 md:pb-4">
      {/* Task 071 (MX-005): 16 px text stops iOS zooming the page on focus;
          the keyboard's action key reads "send"; the mic and send buttons
          are 44 px targets on phones. */}
      <div className="flex items-center gap-1 rounded-md border border-border-soft bg-bg-elev px-2 py-1 md:gap-2 md:px-3.5 md:py-2.5">
        <input
          value={shown}
          onChange={(e) => {
            setValue(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit(value);
          }}
          enterKeyHint="send"
          autoCapitalize="sentences"
          aria-label="Ask Mantua anything or type a trade command"
          placeholder={placeholder ?? "Ask Mantua anything or type a trade command..."}
          data-testid="command-input"
          className={`min-w-0 flex-1 bg-transparent border-none outline-none text-[16px] md:text-[13px] ${
            speaking && voice.transcript.partial !== "" ? "text-text-dim italic" : "text-text"
          }`}
        />
        {voice.supported ? (
          <MicButton phase={voice.phase} onPress={voice.press} onRelease={voice.release} />
        ) : null}
        <button
          type="button"
          onClick={() => {
            submit(value);
          }}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-transparent border-none text-text-dim cursor-pointer md:h-auto md:w-auto md:rounded-none md:p-1"
          aria-label="Send"
        >
          <Send className="h-5 w-5 md:h-4 md:w-4" />
        </button>
      </div>
      {voice.notice ? (
        <p data-testid="voice-notice" className="mt-2 text-[12px] text-text-dim">
          {voice.notice}
        </p>
      ) : null}
    </div>
  );
}
