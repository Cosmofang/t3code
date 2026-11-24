import {
  type BoardCard,
  BoardCardId,
  type BoardColumn,
  BOARD_COLUMNS,
  BoardError,
  type BoardListResult,
  type BoardMutation,
  type OrchestrationV2ThreadShell,
  type ProjectId,
  type ThreadId,
  type ThreadSideTaskId,
} from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import type * as SqlError from "effect/sql/SqlError";

import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import { ensureBoardSchema } from "./boardSchema.ts";

/** Enough for a long-used board; archived cards past it drop off the list first. */
const LIST_LIMIT = 2000;
const AUTO_FLOW_PREF = "auto_flow";

export class BoardService extends Context.Service<
  BoardService,
  {
    readonly list: () => Effect.Effect<BoardListResult, BoardError>;
    readonly subscribeList: () => Stream.Stream<BoardListResult, BoardError>;
    readonly mutate: (mutation: BoardMutation) => Effect.Effect<BoardListResult, BoardError>;
    /** Moves the thread's card after its run state changed; a no-op for unattached threads. */
    readonly syncThread: (threadId: ThreadId) => Effect.Effect<void, BoardError>;
    /** The card a thread sits on, if any. */
    readonly cardForThread: (threadId: ThreadId) => Effect.Effect<BoardCard | null, BoardError>;
  }
>()("t3/board/BoardService") {}

interface CardRow {
  readonly card_id: string;
  readonly title: string;
  readonly details: string;
  readonly column_key: string;
  readonly project_id: string | null;
  readonly due_date: string | null;
  readonly pinned: number;
  readonly sort_order: number | null;
  readonly side_task_id: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly completed_at: string | null;
  readonly archived_at: string | null;
}

interface ThreadRow {
  readonly thread_id: string;
  readonly card_id: string;
}

const isColumn = (value: string): value is BoardColumn =>
  (BOARD_COLUMNS as ReadonlyArray<string>).includes(value);

const toCard = (row: CardRow, threadIds: ReadonlyArray<ThreadId>): BoardCard => ({
  id: BoardCardId.make(row.card_id),
  title: row.title,
  details: row.details,
  column: isColumn(row.column_key) ? row.column_key : "todo",
  projectId: row.project_id as ProjectId | null,
  dueDate: row.due_date,
  pinned: row.pinned !== 0,
  sortOrder: row.sort_order,
  threadIds: [...threadIds],
  sideTaskId: row.side_task_id as ThreadSideTaskId | null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  completedAt: row.completed_at,
  archivedAt: row.archived_at,
});

const boardError = (message: string, options?: { cardId?: string; cause?: unknown }) =>
  new BoardError({
    message,
    ...(options?.cardId === undefined ? {} : { cardId: BoardCardId.make(options.cardId) }),
    ...(options?.cause === undefined ? {} : { cause: options.cause }),
  });

const ACTIVE_RUN_STATUSES = new Set(["preparing", "queued", "starting", "running", "waiting"]);

/** working: an agent is on it. waiting: it stopped for the user. idle: nothing to say. */
export function threadBoardActivity(
  shell: Pick<OrchestrationV2ThreadShell, "activeRunId" | "status" | "pendingRuntimeRequest">,
): "working" | "waiting" | "idle" {
  const request = shell.pendingRuntimeRequest;
  if (request !== null && request.blocking !== false) return "waiting";
  if (shell.activeRunId !== null || ACTIVE_RUN_STATUSES.has(shell.status)) return "working";
  return shell.status === "idle" ? "idle" : "waiting";
}

/**
 * The column a card's threads put it in. Any working thread keeps it in doing; once none works,
 * a thread that stopped for the user moves it to review. Done and archived cards stay put.
 */
function autoFlowColumn(
  card: Pick<BoardCard, "column" | "archivedAt">,
  activities: ReadonlyArray<"working" | "waiting" | "idle">,
  options: { readonly allowReview: boolean },
): BoardColumn | null {
  if (card.column === "done" || card.archivedAt !== null) return null;
  if (activities.includes("working")) return card.column === "doing" ? null : "doing";
  if (!options.allowReview || !activities.includes("waiting")) return null;
  return card.column === "review" ? null : "review";
}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* ensureBoardSchema.pipe(Effect.orDie);
  const threads = yield* ProjectionStore.ProjectionStoreV2;
  // Notifications re-emit the full list; slow subscribers need only the newest dirty signal.
  const changes = yield* PubSub.sliding<void>(1);
  const writes = yield* Semaphore.make(1);

  const readAutoFlow = sql<{ value: string }>`
    SELECT value FROM board_prefs WHERE pref_key = ${AUTO_FLOW_PREF}
  `.pipe(Effect.map((rows) => rows[0]?.value !== "false"));

  const readBoard = Effect.gen(function* () {
    const rows = yield* sql<CardRow>`
      SELECT card_id, title, details, column_key, project_id, due_date, pinned, sort_order,
        side_task_id, created_at, updated_at, completed_at, archived_at
      FROM board_cards
      ORDER BY archived_at IS NOT NULL, created_at DESC, rowid DESC
      LIMIT ${LIST_LIMIT}
    `;
    // Deleted threads drop off their card.
    const links = yield* sql<ThreadRow>`
      SELECT links.thread_id, links.card_id
      FROM board_card_threads AS links
      JOIN orchestration_v2_projection_threads AS threads
        ON threads.thread_id = links.thread_id AND threads.deleted_at IS NULL
      ORDER BY links.attached_at, links.rowid
    `;
    const byCard = new Map<string, Array<ThreadId>>();
    for (const link of links) {
      const list = byCard.get(link.card_id) ?? [];
      list.push(link.thread_id as ThreadId);
      byCard.set(link.card_id, list);
    }
    const cards = rows.map((row) => toCard(row, byCard.get(row.card_id) ?? []));
    return { cards, autoFlow: yield* readAutoFlow };
  });

  const list: BoardService["Service"]["list"] = () =>
    readBoard.pipe(
      NodeSqliteClient.readOnly,
      Effect.mapError((cause) => boardError("Could not read the board.", { cause })),
    );

  const subscribeList: BoardService["Service"]["subscribeList"] = () =>
    Stream.unwrap(
      Effect.gen(function* () {
        // Subscribe before reading to buffer concurrent changes.
        const subscription = yield* PubSub.subscribe(changes);
        return Stream.concat(
          Stream.fromEffect(list()),
          Stream.fromSubscription(subscription).pipe(Stream.mapEffect(() => list())),
        );
      }),
    );

  const readCardRow = (cardId: string) =>
    sql<CardRow>`
      SELECT card_id, title, details, column_key, project_id, due_date, pinned, sort_order,
        side_task_id, created_at, updated_at, completed_at, archived_at
      FROM board_cards WHERE card_id = ${cardId}
    `.pipe(Effect.map((rows) => rows[0] ?? null));

  const requireCard = Effect.fn("BoardService.requireCard")(function* (cardId: string) {
    const row = yield* readCardRow(cardId);
    if (row === null) return yield* boardError("The card was not found.", { cardId });
    return row;
  });

  const write = <A>(effect: Effect.Effect<A, SqlError.SqlError | BoardError>) =>
    writes.withPermit(sql.withTransaction(effect)).pipe(
      Effect.catchTags({
        SqlError: (cause) => Effect.fail(boardError("Could not save the board.", { cause })),
      }),
      Effect.tap(() => PubSub.publish(changes, undefined)),
    );

  const setColumn = (cardId: string, column: BoardColumn, now: string) =>
    sql`
      UPDATE board_cards
      SET column_key = ${column},
        completed_at = CASE WHEN ${column} = 'done' THEN COALESCE(completed_at, ${now}) ELSE NULL END,
        sort_order = CASE WHEN column_key = ${column} THEN sort_order ELSE NULL END,
        updated_at = ${now}
      WHERE card_id = ${cardId}
    `;

  const attach = (cardId: string, threadId: string, now: string) =>
    sql`
      INSERT INTO board_card_threads (thread_id, card_id, attached_at)
      VALUES (${threadId}, ${cardId}, ${now})
      ON CONFLICT (thread_id) DO UPDATE SET card_id = excluded.card_id, attached_at = excluded.attached_at
    `;

  const threadActivity = (threadId: string) =>
    threads.getThreadShell(threadId as ThreadId).pipe(
      Effect.map((shell) =>
        shell === null || shell.deletedAt !== null ? ("idle" as const) : threadBoardActivity(shell),
      ),
      Effect.mapError((cause) => boardError("Could not read a card's thread.", { cause })),
    );

  /** Applies auto flow to one card inside a write. */
  const flowCard = Effect.fn("BoardService.flowCard")(function* (
    cardId: string,
    options: { readonly allowReview: boolean },
    now: string,
  ) {
    if (!(yield* readAutoFlow)) return;
    const row = yield* readCardRow(cardId);
    if (row === null) return;
    const links = yield* sql<ThreadRow>`
        SELECT thread_id, card_id FROM board_card_threads WHERE card_id = ${cardId}
      `;
    const activities = yield* Effect.forEach(links, (link) => threadActivity(link.thread_id));
    const next = autoFlowColumn(
      { column: isColumn(row.column_key) ? row.column_key : "todo", archivedAt: row.archived_at },
      activities,
      options,
    );
    if (next !== null) yield* setColumn(cardId, next, now);
  });

  const mutate: BoardService["Service"]["mutate"] = Effect.fn("BoardService.mutate")(
    function* (mutation) {
      const now = DateTime.formatIso(yield* DateTime.now);
      switch (mutation.type) {
        case "card.create": {
          const column = mutation.column ?? "todo";
          yield* write(
            Effect.gen(function* () {
              if ((yield* readCardRow(mutation.cardId)) !== null) return;
              yield* sql`
                INSERT INTO board_cards (card_id, title, details, column_key, project_id, due_date,
                  pinned, sort_order, side_task_id, created_at, updated_at, completed_at, archived_at)
                VALUES (${mutation.cardId}, ${mutation.title}, ${mutation.details ?? ""}, ${column},
                  ${mutation.projectId ?? null}, ${mutation.dueDate ?? null},
                  ${mutation.pinned === true ? 1 : 0}, NULL, ${mutation.sideTaskId ?? null},
                  ${now}, ${now}, ${column === "done" ? now : null}, NULL)
              `;
              for (const threadId of mutation.threadIds ?? []) {
                yield* attach(mutation.cardId, threadId, now);
              }
              if ((mutation.threadIds ?? []).length > 0) {
                yield* flowCard(mutation.cardId, { allowReview: false }, now);
              }
            }),
          );
          break;
        }
        case "card.update": {
          yield* write(
            Effect.gen(function* () {
              const row = yield* requireCard(mutation.cardId);
              yield* sql`
                UPDATE board_cards SET
                  title = ${mutation.title ?? row.title},
                  details = ${mutation.details ?? row.details},
                  project_id = ${mutation.projectId === undefined ? row.project_id : mutation.projectId},
                  due_date = ${mutation.dueDate === undefined ? row.due_date : mutation.dueDate},
                  pinned = ${mutation.pinned === undefined ? row.pinned : mutation.pinned ? 1 : 0},
                  updated_at = ${now}
                WHERE card_id = ${mutation.cardId}
              `;
            }),
          );
          break;
        }
        case "card.move": {
          yield* write(
            Effect.gen(function* () {
              const row = yield* requireCard(mutation.cardId);
              if (row.column_key !== mutation.column) {
                yield* setColumn(mutation.cardId, mutation.column, now);
              }
              const ordered = mutation.orderedCardIds ?? [];
              for (const [index, cardId] of ordered.entries()) {
                yield* sql`
                  UPDATE board_cards SET sort_order = ${index}
                  WHERE card_id = ${cardId} AND column_key = ${mutation.column}
                `;
              }
            }),
          );
          break;
        }
        case "card.attachThread": {
          yield* write(
            Effect.gen(function* () {
              yield* requireCard(mutation.cardId);
              yield* attach(mutation.cardId, mutation.threadId, now);
              yield* sql`UPDATE board_cards SET updated_at = ${now} WHERE card_id = ${mutation.cardId}`;
              // A running thread brings its card along; one that already stopped leaves it be.
              yield* flowCard(mutation.cardId, { allowReview: false }, now);
            }),
          );
          break;
        }
        case "card.detachThread": {
          yield* write(sql`
            DELETE FROM board_card_threads
            WHERE thread_id = ${mutation.threadId} AND card_id = ${mutation.cardId}
          `);
          break;
        }
        case "card.archive":
        case "card.restore": {
          yield* write(
            Effect.gen(function* () {
              yield* requireCard(mutation.cardId);
              yield* sql`
                UPDATE board_cards
                SET archived_at = ${mutation.type === "card.archive" ? now : null}, updated_at = ${now}
                WHERE card_id = ${mutation.cardId}
              `;
            }),
          );
          break;
        }
        case "card.delete": {
          yield* write(
            Effect.gen(function* () {
              const row = yield* requireCard(mutation.cardId);
              if (row.archived_at === null) {
                return yield* boardError("Only an archived card can be deleted.", {
                  cardId: mutation.cardId,
                });
              }
              yield* sql`DELETE FROM board_card_threads WHERE card_id = ${mutation.cardId}`;
              yield* sql`DELETE FROM board_cards WHERE card_id = ${mutation.cardId}`;
            }),
          );
          break;
        }
        case "board.setAutoFlow": {
          yield* write(sql`
            INSERT INTO board_prefs (pref_key, value)
            VALUES (${AUTO_FLOW_PREF}, ${mutation.enabled ? "true" : "false"})
            ON CONFLICT (pref_key) DO UPDATE SET value = excluded.value
          `);
          break;
        }
      }
      return yield* list();
    },
  );

  const cardIdForThread = (threadId: ThreadId) =>
    sql<ThreadRow>`
      SELECT thread_id, card_id FROM board_card_threads WHERE thread_id = ${threadId}
    `.pipe(Effect.map((rows) => rows[0]?.card_id ?? null));

  const syncThread: BoardService["Service"]["syncThread"] = Effect.fn("BoardService.syncThread")(
    function* (threadId) {
      const cardId = yield* cardIdForThread(threadId).pipe(
        Effect.mapError((cause) => boardError("Could not read the board.", { cause })),
      );
      if (cardId === null) return;
      const now = DateTime.formatIso(yield* DateTime.now);
      yield* write(flowCard(cardId, { allowReview: true }, now));
    },
  );

  const cardForThread: BoardService["Service"]["cardForThread"] = Effect.fn(
    "BoardService.cardForThread",
  )(
    function* (threadId) {
      const cardId = yield* cardIdForThread(threadId);
      if (cardId === null) return null;
      const board = yield* readBoard;
      return board.cards.find((card) => card.id === cardId) ?? null;
    },
    Effect.mapError((cause) => boardError("Could not read the board.", { cause })),
  );

  return BoardService.of({ list, subscribeList, mutate, syncThread, cardForThread });
});

export const layer = Layer.effect(BoardService, make);
