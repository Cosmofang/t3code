import { useDroppable } from "@dnd-kit/core";
import { useGT, useLocale } from "gt-react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { projectIconColorClassName } from "../../projectIconColors";
import { deriveProjectIdentity } from "../../projectIdentity";
import type { EnvironmentBoardCard } from "../../state/board";
import { Button } from "../ui/button";
import { dueState, monthGrid, parseDayKey } from "./board.logic";

const MAX_DOTS = 4;

function CalendarDay({
  day,
  today,
  selected,
  cards,
  projectNameOf,
  onSelect,
}: {
  readonly day: string;
  readonly today: string;
  readonly selected: boolean;
  readonly cards: ReadonlyArray<EnvironmentBoardCard>;
  readonly projectNameOf: (card: EnvironmentBoardCard) => string | null;
  readonly onSelect: () => void;
}) {
  const gt = useGT();
  // Dropping a card on a day sets its due date.
  const { setNodeRef, isOver } = useDroppable({ id: `day:${day}` });
  const past = day < today;
  return (
    <button
      ref={setNodeRef}
      type="button"
      aria-pressed={selected}
      aria-label={gt("{day}, {count} due", { day, count: cards.length })}
      onClick={onSelect}
      className={cn(
        "relative flex h-8 cursor-pointer flex-col items-center rounded-md pt-0.5 text-xs tabular-nums outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        past && "text-muted-foreground",
        day === today && "font-semibold ring-1 ring-ring ring-inset",
        selected && "bg-secondary font-semibold",
        isOver && "bg-primary/15 ring-2 ring-primary",
      )}
    >
      {Number(day.slice(8))}
      {cards.length > 0 ? (
        <span className="absolute inset-x-0 bottom-1 flex justify-center gap-0.5">
          {cards.slice(0, MAX_DOTS).map((card) => {
            const name = projectNameOf(card);
            const done = card.column === "done";
            const overdue = dueState(card, today) === "overdue";
            return (
              <span
                key={card.id}
                className={cn(
                  "size-1 rounded-full",
                  done
                    ? "ring-1 ring-muted-foreground ring-inset"
                    : overdue
                      ? "bg-destructive"
                      : name === null
                        ? "bg-muted-foreground"
                        : cn(
                            "bg-current",
                            projectIconColorClassName(deriveProjectIdentity(name).color),
                          ),
                )}
              />
            );
          })}
        </span>
      ) : null}
    </button>
  );
}

/** A month of due dates: a dot per card, a click filters to the day, a drop sets the date. */
export function BoardCalendar({
  cards,
  today,
  selectedDay,
  projectNameOf,
  onSelectDay,
}: {
  readonly cards: ReadonlyArray<EnvironmentBoardCard>;
  readonly today: string;
  readonly selectedDay: string | null;
  readonly projectNameOf: (card: EnvironmentBoardCard) => string | null;
  readonly onSelectDay: (day: string | null) => void;
}) {
  const gt = useGT();
  const locale = useLocale();
  const [month, setMonth] = useState(() => {
    const start = parseDayKey(selectedDay ?? today) ?? parseDayKey(today);
    return { year: start?.getFullYear() ?? 2026, month: start?.getMonth() ?? 0 };
  });
  const cells = monthGrid(month.year, month.month)
    .flat()
    .map((day, position) => ({ id: day ?? `blank-${position}`, day }));
  const byDay = new Map<string, Array<EnvironmentBoardCard>>();
  for (const card of cards) {
    if (card.dueDate === null) continue;
    const list = byDay.get(card.dueDate) ?? [];
    list.push(card);
    byDay.set(card.dueDate, list);
  }
  const title = new Intl.DateTimeFormat(locale, { year: "numeric", month: "long" }).format(
    new Date(month.year, month.month, 1),
  );
  // 2026-11-23 is a Monday; the grid starts its weeks on Monday.
  const weekdays = [23, 24, 25, 26, 27, 28, 29].map((date) => ({
    id: date,
    label: new Intl.DateTimeFormat(locale, { weekday: "narrow" }).format(new Date(2026, 10, date)),
  }));
  const shift = (delta: number) =>
    setMonth((current) => {
      const next = new Date(current.year, current.month + delta, 1);
      return { year: next.getFullYear(), month: next.getMonth() };
    });
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{title}</span>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={gt("Previous month")}
          onClick={() => shift(-1)}
        >
          <ChevronLeftIcon />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={gt("Next month")}
          onClick={() => shift(1)}
        >
          <ChevronRightIcon />
        </Button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {weekdays.map((weekday) => (
          <span key={weekday.id} className="text-2xs text-muted-foreground">
            {weekday.label}
          </span>
        ))}
        {cells.map(({ id, day }) =>
          day === null ? (
            <span key={id} />
          ) : (
            <CalendarDay
              key={day}
              day={day}
              today={today}
              selected={day === selectedDay}
              cards={byDay.get(day) ?? []}
              projectNameOf={projectNameOf}
              onSelect={() => onSelectDay(day === selectedDay ? null : day)}
            />
          ),
        )}
      </div>
    </div>
  );
}
