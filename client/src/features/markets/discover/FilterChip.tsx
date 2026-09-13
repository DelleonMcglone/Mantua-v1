/** One toggle chip in the Discover filter bar. */
export function Chip<T extends string>({
  value,
  active,
  label,
  onPick,
}: {
  value: T;
  active: boolean;
  label: string;
  onPick: (v: T) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => {
        onPick(value);
      }}
      className={`rounded-full border px-3 py-1 text-[12px] cursor-pointer transition-colors ${
        active
          ? "border-accent bg-accent/15 text-text"
          : "border-border-soft text-text-dim hover:text-text"
      }`}
    >
      {label}
    </button>
  );
}
