import { assert, it } from "@effect/vitest";
import { BoardCardId, type OrchestrationV2ThreadShell, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import { liveThreadShell } from "../mcp/McpToolAccess.testkit.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as BoardService from "./BoardService.ts";

const agent = ThreadId.make("thread:agent");
const helper = ThreadId.make("thread:helper");
const deleted = ThreadId.make("thread:deleted");

type Activity = "working" | "waiting" | "idle";
const activity: Record<string, Activity> = { [agent]: "idle", [helper]: "idle" };

const shellFor = (threadId: ThreadId): OrchestrationV2ThreadShell => {
  const base = liveThreadShell(threadId);
  switch (activity[threadId]) {
    case "working":
      return {
        ...base,
        status: "running",
        activeRunId: "run:1" as never,
        pendingRuntimeRequest: null,
      };
    case "waiting":
      return { ...base, status: "completed", activeRunId: null, pendingRuntimeRequest: null };
    default:
      return { ...base, status: "idle", activeRunId: null, pendingRuntimeRequest: null };
  }
};

const layer = BoardService.layer.pipe(
  Layer.provide(
    Layer.mock(ProjectionStore.ProjectionStoreV2)({
      getThreadShell: (threadId) =>
        Effect.sync(() => (threadId in activity ? shellFor(threadId) : null)),
    }),
  ),
  Layer.provideMerge(SqlitePersistence.layerMemory),
);

const seedThreads = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  for (const [threadId, deletedAt] of [
    [agent, null],
    [helper, null],
    [deleted, "2026-01-02T00:00:00.000Z"],
  ] as const) {
    yield* sql`
      INSERT OR IGNORE INTO orchestration_v2_projection_threads ${sql.insert({
        thread_id: threadId,
        project_id: "project:test",
        title: threadId,
        default_provider: "codex",
        runtime_mode: "full-access",
        interaction_mode: "default",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        deleted_at: deletedAt,
        payload_json: "{}",
      })}
    `;
  }
});

const cardId = (name: string) => BoardCardId.make(`card:${name}`);

it.layer(layer)("BoardService", (it) => {
  it.effect("keeps notes, moves and orders cards, and archives before deleting", () =>
    Effect.gen(function* () {
      yield* seedThreads;
      const board = yield* BoardService.BoardService;
      yield* board.mutate({
        type: "card.create",
        cardId: cardId("a"),
        title: "Send the installer",
      });
      yield* board.mutate({
        type: "card.create",
        cardId: cardId("b"),
        title: "Check Gemini sign-in",
        details: "- [ ] Google\n- [x] API key",
        dueDate: "2026-11-26",
        pinned: true,
      });
      yield* board.mutate({
        type: "card.move",
        cardId: cardId("a"),
        column: "done",
        orderedCardIds: [cardId("a")],
      });
      let result = yield* board.list();
      const sent = result.cards.find((card) => card.id === cardId("a"));
      assert.strictEqual(sent?.column, "done");
      assert.notStrictEqual(sent?.completedAt, null);
      assert.strictEqual(sent?.sortOrder, 0);
      const gemini = result.cards.find((card) => card.id === cardId("b"));
      assert.deepStrictEqual(
        [gemini?.column, gemini?.pinned, gemini?.dueDate],
        ["todo", true, "2026-11-26"],
      );

      // Leaving done clears its finish time and its place there.
      yield* board.mutate({ type: "card.move", cardId: cardId("a"), column: "review" });
      yield* board.mutate({
        type: "card.update",
        cardId: cardId("a"),
        dueDate: null,
        title: "Send it",
      });
      result = yield* board.list();
      const moved = result.cards.find((card) => card.id === cardId("a"));
      assert.deepStrictEqual(
        [moved?.column, moved?.completedAt, moved?.sortOrder, moved?.title],
        ["review", null, null, "Send it"],
      );

      const refused = yield* board
        .mutate({ type: "card.delete", cardId: cardId("a") })
        .pipe(Effect.flip);
      assert.strictEqual(refused._tag, "BoardError");
      yield* board.mutate({ type: "card.archive", cardId: cardId("a") });
      yield* board.mutate({ type: "card.delete", cardId: cardId("a") });
      result = yield* board.list();
      assert.deepStrictEqual(
        result.cards.map((card) => card.id),
        [cardId("b")],
      );
    }),
  );

  it.effect("moves a card with its threads and keeps each thread on one card", () =>
    Effect.gen(function* () {
      yield* seedThreads;
      const board = yield* BoardService.BoardService;
      yield* board.mutate({ type: "card.create", cardId: cardId("work"), title: "Merge main" });
      yield* board.mutate({ type: "card.create", cardId: cardId("other"), title: "Other" });
      const column = (id: BoardCardId) =>
        board.list().pipe(Effect.map((r) => r.cards.find((card) => card.id === id)?.column));

      // A thread that already stopped does not drag its card along when attached.
      activity[agent] = "waiting";
      yield* board.mutate({ type: "card.attachThread", cardId: cardId("work"), threadId: agent });
      assert.strictEqual(yield* column(cardId("work")), "todo");

      activity[agent] = "working";
      yield* board.syncThread(agent);
      assert.strictEqual(yield* column(cardId("work")), "doing");

      // Another working thread keeps it in doing after the first stops.
      activity[helper] = "working";
      yield* board.mutate({ type: "card.attachThread", cardId: cardId("work"), threadId: helper });
      activity[agent] = "waiting";
      yield* board.syncThread(agent);
      assert.strictEqual(yield* column(cardId("work")), "doing");
      activity[helper] = "waiting";
      yield* board.syncThread(helper);
      assert.strictEqual(yield* column(cardId("work")), "review");

      // Done is the user's call.
      yield* board.mutate({ type: "card.move", cardId: cardId("work"), column: "done" });
      activity[agent] = "working";
      yield* board.syncThread(agent);
      assert.strictEqual(yield* column(cardId("work")), "done");

      // Attaching elsewhere moves the thread; deleted threads never show.
      yield* board.mutate({ type: "card.attachThread", cardId: cardId("other"), threadId: helper });
      yield* board.mutate({
        type: "card.attachThread",
        cardId: cardId("other"),
        threadId: deleted,
      });
      const result = yield* board.list();
      assert.deepStrictEqual(result.cards.find((card) => card.id === cardId("work"))?.threadIds, [
        agent,
      ]);
      assert.deepStrictEqual(result.cards.find((card) => card.id === cardId("other"))?.threadIds, [
        helper,
      ]);
      assert.strictEqual((yield* board.cardForThread(helper))?.id, cardId("other"));

      // Off, threads leave cards alone.
      yield* board.mutate({ type: "board.setAutoFlow", enabled: false });
      activity[helper] = "working";
      yield* board.syncThread(helper);
      assert.strictEqual(yield* column(cardId("other")), "todo");
      assert.strictEqual((yield* board.list()).autoFlow, false);
    }),
  );
});

it("reads a thread's activity for the board", () => {
  const base = liveThreadShell(agent);
  assert.strictEqual(
    BoardService.threadBoardActivity({
      ...base,
      status: "idle",
      activeRunId: null,
      pendingRuntimeRequest: null,
    }),
    "idle",
  );
  assert.strictEqual(
    BoardService.threadBoardActivity({
      ...base,
      status: "running",
      activeRunId: "run:1" as never,
      pendingRuntimeRequest: {
        id: "request:1" as never,
        kind: "user_input",
        createdAt: base.createdAt,
      },
    }),
    "waiting",
  );
  assert.strictEqual(
    BoardService.threadBoardActivity({
      ...base,
      status: "failed",
      activeRunId: null,
      pendingRuntimeRequest: null,
    }),
    "waiting",
  );
});
