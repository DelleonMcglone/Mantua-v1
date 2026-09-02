import { useState } from "react";
import { Send } from "lucide-react";

interface Props {
  onSubmit: (text: string) => void;
  /** Logged-out state swaps the placeholder to say login is needed. */
  placeholder?: string | undefined;
}

/**
 * Persistent chat input bar — sits at the bottom of the right-column
 * card and matches prototype `InputBar` in app.jsx. Submits route
 * commands ("swap", "liquidity", "positions") to the parent so the
 * panel can switch routes; free-form text starts a chat conversation
 * (chat surface is a follow-on slice).
 */
export function InputBar({ onSubmit, placeholder }: Props) {
  const [value, setValue] = useState("");

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setValue("");
  };

  return (
    <div className="px-5 pt-3.5 pb-4 border-t border-border-soft">
      <div className="flex items-center gap-2 px-3.5 py-2.5 bg-bg-elev rounded-md border border-border-soft">
        <input
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder={placeholder ?? "Ask Mantua anything or type a trade command..."}
          className="flex-1 bg-transparent border-none outline-none text-[13px] text-text"
        />
        <button
          type="button"
          onClick={submit}
          className="bg-transparent border-none text-text-dim cursor-pointer flex p-1"
          aria-label="Send"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
