import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { PUSH_COPY, PUSH_TOPIC_LABELS, PUSH_TOPICS } from "./push-core.ts";
import { usePush } from "./use-push.ts";

/**
 * Task 071 (MX-004) — the notifications section of the profile. One
 * sentence per state, one button, and five topic rows that each meet the
 * 44 px touch target. The permission prompt only ever follows the tap.
 */
export function NotificationSettings() {
  const push = usePush();
  const on = push.state === "on";
  return (
    <section
      data-testid="notifications"
      data-state={push.state}
      className="mt-3 rounded-md border border-border-soft px-4 py-3.5"
    >
      <h3 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-text-mute">
        <Bell className="h-3.5 w-3.5" /> Notifications
      </h3>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-text-dim">
        {push.state === "loading" ? "Checking…" : PUSH_COPY[push.state]}
      </p>
      {(push.state === "off" || on) && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          <Button
            variant={on ? "ghost" : "primary"}
            size="sm"
            className="h-11 md:h-8"
            disabled={push.busy}
            data-testid="push-toggle"
            onClick={() => {
              void (on ? push.disable() : push.enable());
            }}
          >
            {on ? "Turn off" : "Turn on notifications"}
          </Button>
          {on && (
            <Button
              variant="ghost"
              size="sm"
              className="h-11 md:h-8"
              onClick={() => void push.sendTest()}
            >
              Send a test
            </Button>
          )}
        </div>
      )}
      {on && (
        <ul className="mt-3 flex flex-col divide-y divide-border-soft">
          {PUSH_TOPICS.map((topic) => (
            <li key={topic}>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 py-1.5">
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-[var(--accent)]"
                  checked={push.topics[topic]}
                  onChange={(e) => {
                    void push.setTopic(topic, e.target.checked);
                  }}
                />
                <span className="min-w-0">
                  <span className="block text-[13px] text-text">
                    {PUSH_TOPIC_LABELS[topic].label}
                  </span>
                  <span className="block text-[11.5px] text-text-dim">
                    {PUSH_TOPIC_LABELS[topic].detail}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {push.notice && (
        <p role="status" className="mt-2 text-[12px] text-text-dim">
          {push.notice}
        </p>
      )}
    </section>
  );
}
