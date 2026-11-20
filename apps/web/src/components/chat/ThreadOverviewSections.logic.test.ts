import type { ThreadStructureVisibleTurnItem } from "@t3tools/client-runtime/state/models";
import { describe, expect, it } from "vite-plus/test";

import { latestPlanSteps, threadChangedFiles } from "./ThreadOverviewSections.logic";

const row = (item: Record<string, unknown>) =>
  ({ item }) as unknown as ThreadStructureVisibleTurnItem;

describe("latestPlanSteps", () => {
  it("reads the newest to-do list and ignores other items", () => {
    const steps = latestPlanSteps([
      row({ type: "todo_list", steps: [{ id: "1", text: "Old", status: "running" }] }),
      row({
        type: "todo_list",
        steps: [
          { id: "1", text: "Read", status: "completed" },
          { id: "2", text: "Write", status: "running" },
        ],
      }),
      row({ type: "assistant_message" }),
    ]);
    expect(steps?.map((step) => [step.text, step.status])).toEqual([
      ["Read", "completed"],
      ["Write", "running"],
    ]);
  });

  it("is null for a thread without a plan", () => {
    expect(latestPlanSteps([row({ type: "assistant_message" })])).toBeNull();
  });
});

describe("threadChangedFiles", () => {
  it("lists each file once, in first-change order, with its lines summed", () => {
    expect(
      threadChangedFiles([
        { files: [{ path: "src/a.ts", kind: "modified", additions: 3, deletions: 1 }] },
        {
          files: [
            { path: "docs/b.md", kind: "added", additions: 10, deletions: 0 },
            { path: "src/a.ts", kind: "modified", additions: 2, deletions: 2 },
          ],
        },
      ]),
    ).toEqual([
      { path: "src/a.ts", additions: 5, deletions: 3 },
      { path: "docs/b.md", additions: 10, deletions: 0 },
    ]);
  });
});
