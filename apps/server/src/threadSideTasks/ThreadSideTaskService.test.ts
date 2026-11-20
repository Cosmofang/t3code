import { assert, it } from "@effect/vitest";
import {
  MAX_PENDING_THREAD_SIDE_TASKS,
  type OrchestrationV2ThreadShell,
  ThreadId,
  ThreadSideTaskId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import { liveThreadShell } from "../mcp/McpToolAccess.testkit.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import type * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import { ThreadLaunchService } from "../orchestration-v2/ThreadLaunchService.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ThreadSideTaskService from "./ThreadSideTaskService.ts";

const finder = ThreadId.make("thread:finder");
const worktreeFinder = ThreadId.make("thread:worktree-finder");
const deleted = ThreadId.make("thread:deleted");
const launched = ThreadId.make("thread:launched");

const shells: Record<string, OrchestrationV2ThreadShell> = {
  [finder]: { ...liveThreadShell(finder), branch: "feature/login" },
  [worktreeFinder]: {
    ...liveThreadShell(worktreeFinder),
    branch: "feature/api",
    worktreePath: "/repo/.worktrees/api",
  },
};

const launches: Array<ThreadLaunch.ThreadLaunchInput> = [];

const layer = ThreadSideTaskService.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      Layer.mock(ProjectionStore.ProjectionStoreV2)({
        getThreadShell: (threadId) => Effect.succeed(shells[threadId] ?? null),
      }),
      Layer.mock(ThreadLaunchService)({
        checkWorktreeBase: () => Effect.void,
        launch: (input) =>
          Effect.sync(() => {
            launches.push(input);
            return { threadId: launched, projection: {} as never, resumed: false };
          }),
      }),
    ),
  ),
  Layer.provideMerge(SqlitePersistence.layerMemory),
);

const seedThreads = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  for (const [threadId, deletedAt] of [
    [finder, null],
    [worktreeFinder, null],
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

const taskId = (name: string) => ThreadSideTaskId.make(`side-task:${name}`);

it.layer(layer)("ThreadSideTaskService", (it) => {
  it.effect("offers tasks once per title and hides those of deleted threads", () =>
    Effect.gen(function* () {
      yield* seedThreads;
      const sideTasks = yield* ThreadSideTaskService.ThreadSideTaskService;
      const first = yield* sideTasks.suggest({
        taskId: taskId("flaky"),
        threadId: finder,
        title: "Fix the flaky login test",
        prompt: "The login test fails one run in five; find out why.",
        reason: null,
      });
      const again = yield* sideTasks.suggest({
        taskId: taskId("flaky-again"),
        threadId: finder,
        title: "fix the flaky login test ",
        prompt: "Same thing.",
        reason: null,
      });
      yield* sideTasks.suggest({
        taskId: taskId("gone"),
        threadId: deleted,
        title: "Lost",
        prompt: "Its thread was deleted.",
        reason: null,
      });
      assert.strictEqual(again.task.id, first.task.id);
      assert.strictEqual(again.pending, 1);
      const { tasks } = yield* sideTasks.list();
      assert.deepStrictEqual(
        tasks.map((task) => [task.id, task.status]),
        [[taskId("flaky"), "pending"]],
      );
    }),
  );

  it.effect("refuses an agent past the pending limit", () =>
    Effect.gen(function* () {
      yield* seedThreads;
      const sideTasks = yield* ThreadSideTaskService.ThreadSideTaskService;
      for (let index = 0; index < MAX_PENDING_THREAD_SIDE_TASKS; index += 1) {
        yield* sideTasks.suggest({
          taskId: taskId(`many-${index}`),
          threadId: worktreeFinder,
          title: `Task ${index}`,
          prompt: "Do it.",
          reason: null,
        });
      }
      const refused = yield* sideTasks
        .suggest({
          taskId: taskId("one-too-many"),
          threadId: worktreeFinder,
          title: "One too many",
          prompt: "Do it.",
          reason: null,
        })
        .pipe(Effect.flip);
      assert.include(refused.message, "pending side tasks");
    }),
  );

  it.effect("starts a task in the finding thread's checkout once, and keeps it started", () =>
    Effect.gen(function* () {
      yield* seedThreads;
      launches.length = 0;
      const sideTasks = yield* ThreadSideTaskService.ThreadSideTaskService;
      yield* sideTasks.suggest({
        taskId: taskId("docs"),
        threadId: finder,
        title: "Document the login flow",
        prompt: "Write docs/login.md describing the login flow.",
        reason: "Nobody knows how it works.",
      });
      const started = yield* sideTasks.mutate({
        type: "sideTask.start",
        taskId: taskId("docs"),
        workspace: "same",
      });
      // A second click replays the first launch instead of starting another thread.
      const replay = yield* sideTasks.mutate({
        type: "sideTask.start",
        taskId: taskId("docs"),
        workspace: "same",
      });
      assert.strictEqual(started.startedThreadId, launched);
      assert.strictEqual(replay.startedThreadId, launched);
      assert.strictEqual(launches.length, 1);
      assert.deepStrictEqual(launches[0]?.workspaceStrategy, { type: "root" });
      assert.strictEqual(
        launches[0]?.initialMessage?.text,
        "Write docs/login.md describing the login flow.",
      );
      assert.strictEqual(launches[0]?.title, "Document the login flow");
      const task = started.tasks.find((entry) => entry.id === taskId("docs"));
      assert.strictEqual(task?.status, "started");
      assert.strictEqual(task?.startedThreadId, launched);
      const changed = yield* sideTasks
        .mutate({ type: "sideTask.setStatus", taskId: taskId("docs"), status: "dismissed" })
        .pipe(Effect.flip);
      assert.include(changed.message, "started");
    }),
  );

  it.effect("dismisses a task and brings it back", () =>
    Effect.gen(function* () {
      yield* seedThreads;
      const sideTasks = yield* ThreadSideTaskService.ThreadSideTaskService;
      yield* sideTasks.suggest({
        taskId: taskId("lint"),
        threadId: finder,
        title: "Turn on the unused-import lint",
        prompt: "Enable it and fix what it finds.",
        reason: null,
      });
      const dismissed = yield* sideTasks.mutate({
        type: "sideTask.setStatus",
        taskId: taskId("lint"),
        status: "dismissed",
      });
      const restored = yield* sideTasks.mutate({
        type: "sideTask.setStatus",
        taskId: taskId("lint"),
        status: "pending",
      });
      const status = (tasks: typeof dismissed.tasks) =>
        tasks.find((task) => task.id === taskId("lint"))?.status;
      assert.strictEqual(status(dismissed.tasks), "dismissed");
      assert.strictEqual(status(restored.tasks), "pending");
    }),
  );
});

it("starts in the finding thread's worktree, or a new worktree from its branch", () => {
  const worktreeShell = shells[worktreeFinder]!;
  assert.deepStrictEqual(ThreadSideTaskService.sideTaskWorkspaceStrategy(worktreeShell, "same"), {
    type: "existing_worktree",
    worktreePath: "/repo/.worktrees/api",
    branch: "feature/api",
  });
  assert.deepStrictEqual(
    ThreadSideTaskService.sideTaskWorkspaceStrategy(worktreeShell, "worktree"),
    {
      type: "worktree",
      baseRef: "feature/api",
      startFromOrigin: false,
    },
  );
  assert.strictEqual(
    ThreadSideTaskService.sideTaskWorkspaceStrategy(
      { branch: null, worktreePath: null },
      "worktree",
    ),
    null,
  );
});
