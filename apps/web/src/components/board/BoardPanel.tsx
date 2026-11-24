import type { ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";

import { useRightPanelStore } from "../../rightPanelStore";
import { buildThreadRouteParams } from "../../threadRoutes";
import { BoardView } from "./BoardView";

/** The board as a right panel tab; opening a card's thread keeps the board open beside it. */
export function BoardPanel() {
  const navigate = useNavigate();
  const openThread = (ref: ScopedThreadRef) => {
    useRightPanelStore.getState().open(ref, "board");
    void navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(ref) });
  };
  return (
    <div className="flex h-full min-h-0 flex-col" data-board-panel>
      <BoardView layout="panel" onOpenThread={openThread} />
    </div>
  );
}
