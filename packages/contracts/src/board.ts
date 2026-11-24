import * as Schema from "effect/Schema";

import {
  BoardCardId,
  ForwardCompatibleArray,
  IsoDateTime,
  ProjectId,
  ThreadId,
  ThreadSideTaskId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";

/**
 * todo: not started. doing: someone (the user or an agent) is on it. review: an agent stopped and
 * waits for the user, or the user parked it there. done: the user called it finished.
 */
export const BOARD_COLUMNS = ["todo", "doing", "review", "done"] as const;
export const BoardColumn = Schema.Literals(BOARD_COLUMNS);
export type BoardColumn = typeof BoardColumn.Type;

export const BoardCardTitle = TrimmedNonEmptyString.check(Schema.isMaxLength(200));
/** Markdown; "- [ ]" lines are a checklist the card counts. */
export const BoardCardDetails = Schema.String.check(Schema.isMaxLength(50_000));
/** A calendar day in the user's own time zone, so the shown date never shifts. */
export const BoardDueDate = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/));
export type BoardDueDate = typeof BoardDueDate.Type;

/** A note on the board. Threads are optional attachments; a thread sits on at most one card. */
export const BoardCard = Schema.Struct({
  id: BoardCardId,
  title: BoardCardTitle,
  details: BoardCardDetails,
  column: BoardColumn,
  projectId: Schema.NullOr(ProjectId),
  dueDate: Schema.NullOr(BoardDueDate),
  pinned: Schema.Boolean,
  /** The user's place for it in its column; null keeps the default order. */
  sortOrder: Schema.NullOr(Schema.Finite),
  /** Attached threads, oldest attachment first. */
  threadIds: Schema.Array(ThreadId),
  /** The agent suggestion this card was taken from. */
  sideTaskId: Schema.NullOr(ThreadSideTaskId),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
  archivedAt: Schema.NullOr(IsoDateTime),
});
export type BoardCard = typeof BoardCard.Type;

export const BoardListInput = Schema.Struct({});
export type BoardListInput = typeof BoardListInput.Type;

export const BoardListResult = Schema.Struct({
  cards: ForwardCompatibleArray(BoardCard),
  /** Attached threads move their card between doing and review. */
  autoFlow: Schema.Boolean,
});
export type BoardListResult = typeof BoardListResult.Type;

export const BoardMutation = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("card.create"),
    cardId: BoardCardId,
    title: BoardCardTitle,
    details: Schema.optional(BoardCardDetails),
    column: Schema.optional(BoardColumn),
    projectId: Schema.optional(Schema.NullOr(ProjectId)),
    dueDate: Schema.optional(Schema.NullOr(BoardDueDate)),
    pinned: Schema.optional(Schema.Boolean),
    threadIds: Schema.optional(Schema.Array(ThreadId)),
    sideTaskId: Schema.optional(Schema.NullOr(ThreadSideTaskId)),
  }),
  Schema.Struct({
    type: Schema.Literal("card.update"),
    cardId: BoardCardId,
    title: Schema.optional(BoardCardTitle),
    details: Schema.optional(BoardCardDetails),
    projectId: Schema.optional(Schema.NullOr(ProjectId)),
    dueDate: Schema.optional(Schema.NullOr(BoardDueDate)),
    pinned: Schema.optional(Schema.Boolean),
  }),
  Schema.Struct({
    // Moves a card into a column; orderedCardIds is that column's order afterwards, when the user placed it.
    type: Schema.Literal("card.move"),
    cardId: BoardCardId,
    column: BoardColumn,
    orderedCardIds: Schema.optional(Schema.Array(BoardCardId)),
  }),
  Schema.Struct({
    // Takes the thread off any other card first.
    type: Schema.Literal("card.attachThread"),
    cardId: BoardCardId,
    threadId: ThreadId,
  }),
  Schema.Struct({
    type: Schema.Literal("card.detachThread"),
    cardId: BoardCardId,
    threadId: ThreadId,
  }),
  Schema.Struct({ type: Schema.Literal("card.archive"), cardId: BoardCardId }),
  Schema.Struct({ type: Schema.Literal("card.restore"), cardId: BoardCardId }),
  /** Only an archived card can be deleted for good. */
  Schema.Struct({ type: Schema.Literal("card.delete"), cardId: BoardCardId }),
  Schema.Struct({ type: Schema.Literal("board.setAutoFlow"), enabled: Schema.Boolean }),
]);
export type BoardMutation = typeof BoardMutation.Type;

export const BoardMutationResult = BoardListResult;
export type BoardMutationResult = typeof BoardMutationResult.Type;

export class BoardError extends Schema.TaggedError<BoardError>()("BoardError", {
  message: Schema.String,
  cardId: Schema.optional(BoardCardId),
  cause: Schema.optional(Schema.Defect()),
}) {}
