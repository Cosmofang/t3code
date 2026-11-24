import type { ScopedThreadRef } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useGT } from "gt-react";
import { AlignLeftIcon, PinIcon } from "lucide-react";

import { cn } from "../../lib/utils";
import { projectIconColorClassName } from "../../projectIconColors";
import { deriveProjectIdentity } from "../../projectIdentity";
import type { EnvironmentBoardCard } from "../../state/board";
import { checklistProgress, daysUntil, dueState } from "./board.logic";
import { BoardThreadRow } from "./BoardThreadRow";

function useDueLabel() {
  const gt = useGT();
  return (dueDate: string, today: string) => {
    const days = daysUntil(dueDate, today);
    if (days === 0) return gt("Today", { $context: "due date label" });
    if (days === 1) return gt("Tomorrow", { $context: "due date label" });
    if (days < 0) return gt("{count} days overdue", { count: -days });
    const [, month, day] = dueDate.split("-");
    return gt("{month}/{day}", { month: Number(month), day: Number(day) });
  };
}

export function ProjectDot({ name, className }: { name: string | null; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-1.5 shrink-0 rounded-full bg-current",
        name === null
          ? "text-muted-foreground/60"
          : projectIconColorClassName(deriveProjectIdentity(name).color),
        className,
      )}
    />
  );
}

/** A card's face: title, then the facts it has, then its threads. Details stay behind a click. */
export function BoardCardItem({
  card,
  projectName,
  today,
  dragging,
  onOpen,
  onOpenThread,
}: {
  readonly card: EnvironmentBoardCard;
  readonly projectName: string | null;
  readonly today: string;
  readonly dragging?: boolean | undefined;
  readonly onOpen: () => void;
  readonly onOpenThread: (ref: ScopedThreadRef) => void;
}) {
  const gt = useGT();
  const dueLabel = useDueLabel();
  const due = dueState(card, today);
  const progress = checklistProgress(card.details);
  const hasDetails = card.details.trim().length > 0;
  const done = card.column === "done";
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        "flex cursor-pointer flex-col gap-1 rounded-lg border border-border bg-card px-2.5 py-2 text-left outline-none transition-shadow hover:border-ring/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        dragging && "shadow-lg",
        done && "opacity-60",
      )}
    >
      <div className="flex min-w-0 items-start gap-1.5">
        <span
          className={cn(
            "min-w-0 flex-1 text-sm leading-5 font-medium break-words text-foreground",
            done && "font-normal text-muted-foreground line-through decoration-1",
          )}
        >
          {card.title}
        </span>
        {hasDetails ? (
          <AlignLeftIcon
            aria-label={gt("Has details")}
            className="mt-1 size-3 shrink-0 text-muted-foreground/60"
          />
        ) : null}
        {card.pinned ? (
          <PinIcon aria-label={gt("Pinned")} className="mt-1 size-3 shrink-0 text-primary" />
        ) : null}
      </div>
      {card.dueDate !== null || projectName !== null || progress !== null ? (
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-2xs text-muted-foreground">
          {card.dueDate !== null ? (
            <span
              className={cn(
                "rounded px-1.5 tabular-nums",
                due === "overdue"
                  ? "bg-destructive/12 text-destructive-foreground"
                  : due === "today"
                    ? "bg-warning/14 text-warning-foreground"
                    : "bg-secondary",
              )}
            >
              {done ? card.dueDate.slice(5).replace("-", "/") : dueLabel(card.dueDate, today)}
            </span>
          ) : null}
          {projectName !== null ? (
            <span className="flex min-w-0 items-center gap-1">
              <ProjectDot name={projectName} />
              <span className="truncate">{projectName}</span>
            </span>
          ) : null}
          {progress !== null ? (
            <span className="ml-auto tabular-nums">
              {progress.done}/{progress.total}
            </span>
          ) : null}
        </div>
      ) : null}
      {card.threadIds.length > 0 ? (
        <div className="flex flex-col gap-0.5">
          {card.threadIds.map((threadId) => (
            <BoardThreadRow
              key={threadId}
              environmentId={card.environmentId}
              threadId={threadId}
              onOpen={() => onOpenThread(scopeThreadRef(card.environmentId, threadId))}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
