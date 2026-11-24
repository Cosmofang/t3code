import {
  BoardCardId,
  type ContextMenuItem,
  type EnvironmentId,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import { msg } from "gt-react";

import { m, type MessageResolver } from "../i18n/messages";
import { mutateBoard, newBoardCardId, readBoard } from "../state/board";

export type BoardMenuId = "board" | "board:new" | "board:remove" | `board:card:${string}`;

const CARD_PREFIX = "board:card:";
/** Enough open cards to pick from; older ones are on the board itself. */
const MAX_MENU_CARDS = 15;

export function isBoardMenuId(id: string): id is BoardMenuId {
  return (
    id === "board" || id === "board:new" || id === "board:remove" || id.startsWith(CARD_PREFIX)
  );
}

interface BoardMenuThread {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly canOperate: boolean;
}

/** "Add to board": a new card for the thread, or one of the open cards. */
export function buildBoardMenuItem(
  input: BoardMenuThread,
  resolve: MessageResolver = m,
): ContextMenuItem<BoardMenuId> | null {
  const board = readBoard();
  if (!board.environmentIds.includes(input.environmentId)) return null;
  const cards = board.cards.filter(
    (card) => card.environmentId === input.environmentId && card.archivedAt === null,
  );
  const current = cards.find((card) => card.threadIds.includes(input.threadId)) ?? null;
  const open = cards
    .filter((card) => card.column !== "done" || card.id === current?.id)
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, MAX_MENU_CARDS);
  const disabled = !input.canOperate;
  return {
    id: "board",
    label: resolve(msg("Add to board")),
    icon: "kanban",
    disabled,
    children: [
      { id: "board:new", label: resolve(msg("New card from this thread")), disabled },
      ...open.map((card, index) => ({
        id: `${CARD_PREFIX}${card.id}` as const,
        label: card.title,
        checked: card.id === current?.id,
        separatorBefore: index === 0,
        disabled,
      })),
      ...(current === null
        ? []
        : [
            {
              id: "board:remove" as const,
              label: resolve(msg("Remove from card")),
              separatorBefore: true,
              disabled,
            },
          ]),
    ],
  };
}

/** Runs a board menu choice; true when the id was a board one. */
export function runBoardMenuAction(
  id: string,
  thread: BoardMenuThread & {
    readonly title: string;
    readonly projectId: ProjectId | null;
    /** An agent is on it now, so a new card starts in doing rather than review. */
    readonly working: boolean;
  },
): boolean {
  if (!isBoardMenuId(id)) return false;
  const failure = m(msg("Could not update the board"));
  if (id === "board:new") {
    void mutateBoard(
      thread.environmentId,
      {
        type: "card.create",
        cardId: newBoardCardId(),
        title: thread.title.trim().slice(0, 200) || m(msg("Untitled card")),
        projectId: thread.projectId,
        column: thread.working ? "doing" : "review",
        threadIds: [thread.threadId],
      },
      failure,
    );
    return true;
  }
  if (id === "board:remove") {
    const card = readBoard().cards.find(
      (entry) =>
        entry.environmentId === thread.environmentId && entry.threadIds.includes(thread.threadId),
    );
    if (card) {
      void mutateBoard(
        thread.environmentId,
        { type: "card.detachThread", cardId: card.id, threadId: thread.threadId },
        failure,
      );
    }
    return true;
  }
  if (id.startsWith(CARD_PREFIX)) {
    void mutateBoard(
      thread.environmentId,
      {
        type: "card.attachThread",
        cardId: BoardCardId.make(id.slice(CARD_PREFIX.length)),
        threadId: thread.threadId,
      },
      failure,
    );
  }
  return true;
}
