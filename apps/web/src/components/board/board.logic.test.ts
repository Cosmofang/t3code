import { BoardCardId, type BoardCard } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  checklistProgress,
  columnOrderAfterDrop,
  daysUntil,
  dueState,
  monthGrid,
  orderColumn,
} from "./board.logic";

const card = (id: string, fields: Partial<BoardCard> = {}): BoardCard => ({
  id: BoardCardId.make(id),
  title: id,
  details: "",
  column: "todo",
  projectId: null,
  dueDate: null,
  pinned: false,
  sortOrder: null,
  threadIds: [],
  sideTaskId: null,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  completedAt: null,
  archivedAt: null,
  ...fields,
});

describe("board order", () => {
  it("puts pinned cards first, then the nearest due date, then undated cards", () => {
    const ordered = orderColumn([
      card("undated"),
      card("later", { dueDate: "2026-11-30" }),
      card("pinned", { pinned: true, dueDate: "2026-12-30" }),
      card("soon", { dueDate: "2026-11-25" }),
    ]);
    expect(ordered.map((c) => c.id)).toEqual(["pinned", "soon", "later", "undated"]);
  });

  it("keeps cards the user placed in the user's order", () => {
    const ordered = orderColumn([
      card("a", { dueDate: "2026-11-25", sortOrder: 1 }),
      card("b", { dueDate: "2026-11-26", sortOrder: 0 }),
      card("new", { dueDate: "2026-11-27" }),
    ]);
    expect(ordered.map((c) => c.id)).toEqual(["b", "a", "new"]);
  });

  it("builds a column's order after a drop", () => {
    const column = [card("a"), card("b"), card("c")];
    expect(columnOrderAfterDrop(column, BoardCardId.make("c"), 0)).toEqual(["c", "a", "b"]);
    expect(columnOrderAfterDrop(column, BoardCardId.make("x"), 9)).toEqual(["a", "b", "c", "x"]);
  });
});

describe("due dates", () => {
  it("marks overdue only after the day, and never for done cards", () => {
    expect(daysUntil("2026-11-22", "2026-11-24")).toBe(-2);
    expect(dueState(card("a", { dueDate: "2026-11-24" }), "2026-11-24")).toBe("today");
    expect(dueState(card("a", { dueDate: "2026-11-23" }), "2026-11-24")).toBe("overdue");
    expect(dueState(card("a", { dueDate: "2026-11-23", column: "done" }), "2026-11-24")).toBe(
      "upcoming",
    );
    expect(dueState(card("a"), "2026-11-24")).toBeNull();
  });

  it("lays a month out in Monday-first weeks", () => {
    const weeks = monthGrid(2026, 10);
    expect(weeks[0]).toEqual([null, null, null, null, null, null, "2026-11-01"]);
    expect(weeks.at(-1)?.[0]).toBe("2026-11-30");
  });
});

describe("checklists", () => {
  it("counts checked and open boxes, nested ones too", () => {
    const details = [
      "Before release",
      "- [x] Merge main",
      "- [ ] Try the installer",
      "  * [ ] nested",
    ].join("\n");
    expect(checklistProgress(details)).toEqual({ done: 1, total: 3 });
    expect(checklistProgress("no boxes")).toBeNull();
  });
});
