import type { ThreadStructureVisibleTurnItem } from "@t3tools/client-runtime/state/models";
import type { ThreadCheckpointSummary } from "@t3tools/client-runtime/state/thread-checkpoints";
import type { OrchestrationV2PlanStep } from "@t3tools/contracts";

export interface ChangedFile {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
}

/** The agent's newest plan: the last to-do list it wrote in this thread. */
export function latestPlanSteps(
  items: ReadonlyArray<ThreadStructureVisibleTurnItem>,
): ReadonlyArray<OrchestrationV2PlanStep> | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]!.item;
    if (item.type === "todo_list") return item.steps;
  }
  return null;
}

/** Every file the thread's turns changed, in the order they first changed it, with line totals. */
export function threadChangedFiles(
  summaries: ReadonlyArray<Pick<ThreadCheckpointSummary, "files">>,
): ReadonlyArray<ChangedFile> {
  const byPath = new Map<string, ChangedFile>();
  for (const summary of summaries) {
    for (const file of summary.files) {
      const previous = byPath.get(file.path);
      byPath.set(file.path, {
        path: file.path,
        additions: (previous?.additions ?? 0) + file.additions,
        deletions: (previous?.deletions ?? 0) + file.deletions,
      });
    }
  }
  return [...byPath.values()];
}
