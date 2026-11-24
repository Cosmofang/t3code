import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { useEffect } from "react";

import { selectThreadRightPanelState, useRightPanelStore } from "../../rightPanelStore";

// Whether the thread on screen showed the board as its panel tab, read when the next one opens.
let boardWasShowing = false;

function boardShowing(ref: ScopedThreadRef): boolean {
  const state = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, ref);
  if (!state.isOpen) return false;
  return state.surfaces.find((surface) => surface.id === state.activeSurfaceId)?.kind === "board";
}

/**
 * Panels belong to threads, but the board does not: when the thread you leave showed it, the
 * thread you open shows it too. Hiding the board in one thread stops it following.
 */
export function useBoardPanelFollow(ref: ScopedThreadRef | null): void {
  const environmentId: EnvironmentId | null = ref?.environmentId ?? null;
  const threadId: ThreadId | null = ref?.threadId ?? null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- carries the board tab across thread switches through the right panel store
  useEffect(() => {
    if (environmentId === null || threadId === null) return;
    const current = scopeThreadRef(environmentId, threadId);
    if (boardWasShowing && !boardShowing(current)) {
      useRightPanelStore.getState().open(current, "board");
    }
    const update = () => {
      boardWasShowing = boardShowing(current);
    };
    update();
    return useRightPanelStore.subscribe(update);
  }, [environmentId, threadId]);
}
