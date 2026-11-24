import type { BoardCard, BoardColumn } from "@t3tools/contracts";

/** The local calendar day as YYYY-MM-DD; due dates are stored the same way. */
export function dayKey(date: Date = new Date()): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export function parseDayKey(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return dayKey(date) === value ? date : null;
}

/** Whole days from today to the due day; negative once it has passed. */
export function daysUntil(dueDate: string, today: string): number {
  const due = parseDayKey(dueDate);
  const now = parseDayKey(today);
  if (!due || !now) return 0;
  return Math.round((due.getTime() - now.getTime()) / 86_400_000);
}

export type DueState = "overdue" | "today" | "upcoming";

/** Overdue only once the due day is over and the card is not done. */
export function dueState(
  card: Pick<BoardCard, "dueDate" | "column">,
  today: string,
): DueState | null {
  if (card.dueDate === null) return null;
  const days = daysUntil(card.dueDate, today);
  if (days < 0) return card.column === "done" ? "upcoming" : "overdue";
  return days === 0 ? "today" : "upcoming";
}

type Orderable = Pick<
  BoardCard,
  "id" | "pinned" | "dueDate" | "createdAt" | "sortOrder" | "completedAt" | "column"
>;

function defaultCompare(a: Orderable, b: Orderable): number {
  if (a.column === "done" && b.column === "done" && a.completedAt !== b.completedAt) {
    return (b.completedAt ?? "").localeCompare(a.completedAt ?? "");
  }
  if (a.dueDate !== b.dueDate) {
    if (a.dueDate === null) return 1;
    if (b.dueDate === null) return -1;
    return a.dueDate.localeCompare(b.dueDate);
  }
  if (a.createdAt !== b.createdAt) return a.createdAt.localeCompare(b.createdAt);
  return a.id.localeCompare(b.id);
}

/** Default order, with the cards the user placed filling their own slots in the user's order. */
function orderGroup<T extends Orderable>(cards: ReadonlyArray<T>): Array<T> {
  const byDefault = [...cards].sort(defaultCompare);
  const placed = byDefault
    .filter((card) => card.sortOrder !== null)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  if (placed.length < 2) return byDefault;
  let next = 0;
  return byDefault.map((card) => (card.sortOrder === null ? card : (placed[next++] ?? card)));
}

/** A column's cards: pinned first, then by due date, keeping where the user placed them. */
export function orderColumn<T extends Orderable>(cards: ReadonlyArray<T>): Array<T> {
  return [
    ...orderGroup(cards.filter((card) => card.pinned)),
    ...orderGroup(cards.filter((card) => !card.pinned)),
  ];
}

const CHECKLIST_LINE = /^(\s*[-*+]\s+\[)([ xX])(\]\s?)(.*)$/;

interface ChecklistItem {
  readonly line: number;
  readonly checked: boolean;
  readonly text: string;
}

function checklistItems(details: string): Array<ChecklistItem> {
  const items: Array<ChecklistItem> = [];
  details.split("\n").forEach((line, index) => {
    const match = CHECKLIST_LINE.exec(line);
    if (match) items.push({ line: index, checked: match[2] !== " ", text: match[4] ?? "" });
  });
  return items;
}

export function checklistProgress(details: string): { done: number; total: number } | null {
  const items = checklistItems(details);
  if (items.length === 0) return null;
  return { done: items.filter((item) => item.checked).length, total: items.length };
}

/** Monday-first weeks covering the month; days outside it are null. */
export function monthGrid(year: number, month: number): Array<Array<string | null>> {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: Array<string | null> = Array.from({ length: lead }, () => null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(dayKey(new Date(year, month, day)));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: Array<Array<string | null>> = [];
  for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7));
  return weeks;
}

/** Done cards older than this fold away under the column. */
const RECENT_DONE_DAYS = 7;

export function isRecentlyDone(card: Pick<BoardCard, "completedAt">, now: Date): boolean {
  if (card.completedAt === null) return true;
  return now.getTime() - Date.parse(card.completedAt) <= RECENT_DONE_DAYS * 86_400_000;
}

export const BOARD_COLUMN_ORDER: ReadonlyArray<BoardColumn> = ["todo", "doing", "review", "done"];

/**
 * The ids a column holds after a card lands at `index` in it, for `card.move`'s order.
 * `cards` is the column's current order and may already hold the moved card.
 */
export function columnOrderAfterDrop(
  cards: ReadonlyArray<Pick<BoardCard, "id">>,
  movedId: BoardCard["id"],
  index: number,
): Array<BoardCard["id"]> {
  const ids = cards.map((card) => card.id).filter((id) => id !== movedId);
  const at = Math.max(0, Math.min(index, ids.length));
  ids.splice(at, 0, movedId);
  return ids;
}

/** The text a new thread starts from: the title, then the details when there are any. */
export function cardPrompt(card: Pick<BoardCard, "title" | "details">): string {
  const details = card.details.trim();
  return details.length === 0 ? card.title : `${card.title}\n\n${details}`;
}
