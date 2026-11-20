import type { ContextWindowSnapshot } from "@t3tools/client-runtime/state/context-window";
import { useGT, useLocale } from "gt-react";

import { formatContextWindowTokens } from "../../lib/contextWindow";
import { cn } from "../../lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const RADIUS = 6;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** The open thread's context window as a ring beside the send button; hover shows the token counts. */
export function ComposerContextMeter({
  usage,
  showTokens = true,
  outputTokensPerSecond = null,
}: {
  readonly usage: ContextWindowSnapshot | null;
  /** Off while the Compact chip already shows the token count. */
  readonly showTokens?: boolean;
  /** Fork: the newest model request's output speed. */
  readonly outputTokensPerSecond?: number | null;
}) {
  const gt = useGT();
  const locale = useLocale();
  if (usage === null) return null;
  const maxTokens = usage.maxTokens != null && usage.maxTokens > 0 ? usage.maxTokens : null;
  const used =
    maxTokens !== null && usage.usedPercentage !== null
      ? Math.round(Math.max(0, Math.min(100, usage.usedPercentage)))
      : null;
  const usedTokens = formatContextWindowTokens(usage.usedTokens);
  const speed =
    outputTokensPerSecond === null ? null : gt("{tokens} tok/s", { tokens: outputTokensPerSecond });
  const label =
    used !== null
      ? gt("Context: {used}% used", { used })
      : gt("Context: {usedTokens} tokens used", { usedTokens });
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="img"
            tabIndex={0}
            aria-label={label}
            className={cn(
              "inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-1 text-xs tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              used !== null && used >= 90
                ? "text-error-foreground"
                : used !== null && used >= 80
                  ? "text-warning-foreground"
                  : "text-muted-foreground",
            )}
          />
        }
      >
        <svg aria-hidden viewBox="0 0 16 16" className="size-4 -rotate-90">
          <circle
            cx="8"
            cy="8"
            r={RADIUS}
            fill="none"
            stroke="currentColor"
            strokeOpacity={0.2}
            strokeWidth={2}
          />
          {used !== null ? (
            <circle
              cx="8"
              cy="8"
              r={RADIUS}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={CIRCUMFERENCE * (1 - used / 100)}
            />
          ) : null}
        </svg>
        <span>
          {used !== null && maxTokens !== null
            ? showTokens
              ? `${used}% · ${usedTokens} / ${formatContextWindowTokens(maxTokens)}`
              : `${used}%`
            : usedTokens}
          {speed !== null ? ` · ${speed}` : null}
        </span>
      </TooltipTrigger>
      <TooltipPopup side="top">
        {/* The popup wraps its children, so the column lives here. */}
        <div className="flex flex-col">
          <span>{label}</span>
          {maxTokens !== null ? (
            <span className="text-muted-foreground">
              {gt("{used} of {max} tokens", {
                used: usage.usedTokens.toLocaleString(locale),
                max: maxTokens.toLocaleString(locale),
              })}
            </span>
          ) : null}
          {speed !== null ? (
            <span className="text-muted-foreground">
              {gt("{speed} from the latest model request", { speed })}
            </span>
          ) : null}
        </div>
      </TooltipPopup>
    </Tooltip>
  );
}
