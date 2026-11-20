import {
  CommandId,
  MAX_PENDING_THREAD_SIDE_TASKS,
  type OrchestrationV2ThreadShell,
  type ThreadId,
  type ThreadSideTask,
  ThreadSideTaskError,
  ThreadSideTaskId,
  type ThreadSideTaskListResult,
  type ThreadSideTaskMutation,
  type ThreadSideTaskMutationResult,
  type ThreadSideTaskStatus,
  type ThreadSideTaskWorkspace,
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
import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import { ensureThreadSideTaskSchema } from "./threadSideTaskSchema.ts";

/** Newest first; enough for every open thread's panel without growing without bound. */
const LIST_LIMIT = 500;

export class ThreadSideTaskService extends Context.Service<
  ThreadSideTaskService,
  {
    /** Records a task an agent found; the same pending title in one thread returns the first. */
    readonly suggest: (input: {
      readonly taskId: ThreadSideTaskId;
      readonly threadId: ThreadId;
      readonly title: string;
      readonly prompt: string;
      readonly reason: string | null;
    }) => Effect.Effect<
      { readonly task: ThreadSideTask; readonly pending: number },
      ThreadSideTaskError
    >;
    readonly list: () => Effect.Effect<ThreadSideTaskListResult, ThreadSideTaskError>;
    readonly subscribeList: () => Stream.Stream<ThreadSideTaskListResult, ThreadSideTaskError>;
    readonly mutate: (
      mutation: ThreadSideTaskMutation,
    ) => Effect.Effect<ThreadSideTaskMutationResult, ThreadSideTaskError>;
  }
>()("t3/threadSideTasks/ThreadSideTaskService") {}

interface TaskRow {
  readonly task_id: string;
  readonly thread_id: string;
  readonly title: string;
  readonly prompt: string;
  readonly reason: string | null;
  readonly status: string;
  readonly started_thread_id: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

const TASK_STATUSES: ReadonlyArray<ThreadSideTaskStatus> = [
  "pending",
  "started",
  "here",
  "dismissed",
];

const toTask = (row: TaskRow): ThreadSideTask => ({
  id: row.task_id as ThreadSideTask["id"],
  threadId: row.thread_id as ThreadId,
  title: row.title,
  prompt: row.prompt,
  reason: row.reason,
  status: TASK_STATUSES.includes(row.status as ThreadSideTaskStatus)
    ? (row.status as ThreadSideTaskStatus)
    : "pending",
  startedThreadId: row.started_thread_id as ThreadId | null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const sideTaskError = (message: string, options?: { taskId?: string; cause?: unknown }) =>
  new ThreadSideTaskError({
    message,
    ...(options?.taskId === undefined ? {} : { taskId: ThreadSideTaskId.make(options.taskId) }),
    ...(options?.cause === undefined ? {} : { cause: options.cause }),
  });

/** Where a started task works: the finding thread's checkout, or a new worktree from its branch. */
export function sideTaskWorkspaceStrategy(
  shell: Pick<OrchestrationV2ThreadShell, "branch" | "worktreePath">,
  workspace: ThreadSideTaskWorkspace,
): ThreadLaunch.ThreadLaunchInput["workspaceStrategy"] | null {
  if (workspace === "worktree") {
    // Local base: the finding thread's branch may hold commits the remote lacks.
    return shell.branch === null
      ? null
      : { type: "worktree", baseRef: shell.branch, startFromOrigin: false };
  }
  // A root launch with a branch could switch the user's checkout, so root work stays on whatever is checked out.
  return shell.worktreePath === null
    ? { type: "root" }
    : {
        type: "existing_worktree",
        worktreePath: shell.worktreePath,
        ...(shell.branch === null ? {} : { branch: shell.branch }),
      };
}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* ensureThreadSideTaskSchema.pipe(Effect.orDie);
  const threads = yield* ProjectionStore.ProjectionStoreV2;
  const launches = yield* ThreadLaunch.ThreadLaunchService;
  // Notifications re-emit the full list; slow subscribers need only the newest dirty signal.
  const changes = yield* PubSub.sliding<void>(1);
  const writes = yield* Semaphore.make(1);

  const readTasks = Effect.gen(function* () {
    const rows = yield* sql<TaskRow>`
      SELECT tasks.task_id, tasks.thread_id, tasks.title, tasks.prompt, tasks.reason, tasks.status,
        tasks.started_thread_id, tasks.created_at, tasks.updated_at
      FROM thread_side_tasks AS tasks
      JOIN orchestration_v2_projection_threads AS threads
        ON threads.thread_id = tasks.thread_id AND threads.deleted_at IS NULL
      ORDER BY tasks.created_at DESC, tasks.rowid DESC
      LIMIT ${LIST_LIMIT}
    `;
    return rows.map(toTask);
  });

  const list: ThreadSideTaskService["Service"]["list"] = () =>
    readTasks.pipe(
      NodeSqliteClient.readOnly,
      Effect.map((tasks) => ({ tasks })),
      Effect.mapError((cause) => sideTaskError("Could not list side tasks.", { cause })),
    );

  const subscribeList: ThreadSideTaskService["Service"]["subscribeList"] = () =>
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

  const readTask = Effect.fn("ThreadSideTaskService.readTask")(function* (taskId: string) {
    const rows = yield* sql<TaskRow>`
      SELECT task_id, thread_id, title, prompt, reason, status, started_thread_id, created_at, updated_at
      FROM thread_side_tasks WHERE task_id = ${taskId}
    `.pipe(Effect.mapError((cause) => sideTaskError("Could not read the side task.", { cause })));
    const row = rows[0];
    if (row === undefined) return yield* sideTaskError("The side task was not found.", { taskId });
    return toTask(row);
  });

  const write = <A>(effect: Effect.Effect<A, SqlError.SqlError | ThreadSideTaskError>) =>
    writes.withPermit(sql.withTransaction(effect)).pipe(
      Effect.catchTags({
        SqlError: (cause) => Effect.fail(sideTaskError("Could not save the side task.", { cause })),
      }),
      Effect.tap(() => PubSub.publish(changes, undefined)),
    );

  const suggest: ThreadSideTaskService["Service"]["suggest"] = Effect.fn(
    "ThreadSideTaskService.suggest",
  )(function* (input) {
    const now = DateTime.formatIso(yield* DateTime.now);
    return yield* write(
      Effect.gen(function* () {
        const pending = yield* sql<TaskRow>`
          SELECT task_id, thread_id, title, prompt, reason, status, started_thread_id, created_at, updated_at
          FROM thread_side_tasks
          WHERE thread_id = ${input.threadId} AND status = 'pending'
        `;
        const existing = pending.find(
          (row) => row.title.trim().toLowerCase() === input.title.trim().toLowerCase(),
        );
        if (existing !== undefined) return { task: toTask(existing), pending: pending.length };
        if (pending.length >= MAX_PENDING_THREAD_SIDE_TASKS) {
          return yield* sideTaskError(
            `This thread already has ${pending.length} pending side tasks; wait for the user to start or dismiss some.`,
          );
        }
        const row: TaskRow = {
          task_id: input.taskId,
          thread_id: input.threadId,
          title: input.title,
          prompt: input.prompt,
          reason: input.reason,
          status: "pending",
          started_thread_id: null,
          created_at: now,
          updated_at: now,
        };
        yield* sql`
          INSERT INTO thread_side_tasks
            (task_id, thread_id, title, prompt, reason, status, started_thread_id, created_at, updated_at)
          VALUES (${row.task_id}, ${row.thread_id}, ${row.title}, ${row.prompt}, ${row.reason},
            ${row.status}, NULL, ${row.created_at}, ${row.updated_at})
        `;
        return { task: toTask(row), pending: pending.length + 1 };
      }),
    );
  });

  const setStatus = Effect.fn("ThreadSideTaskService.setStatus")(function* (
    taskId: string,
    status: ThreadSideTaskStatus,
    startedThreadId: ThreadId | null,
  ) {
    const now = DateTime.formatIso(yield* DateTime.now);
    yield* write(sql`
      UPDATE thread_side_tasks
      SET status = ${status}, started_thread_id = ${startedThreadId}, updated_at = ${now}
      WHERE task_id = ${taskId}
    `);
  });

  const start = Effect.fn("ThreadSideTaskService.start")(function* (
    taskId: string,
    workspace: ThreadSideTaskWorkspace,
  ) {
    const task = yield* readTask(taskId);
    // A retry after the launch landed finds the task started and returns that thread.
    if (task.status === "started" && task.startedThreadId !== null) return task.startedThreadId;
    if (task.status !== "pending") {
      return yield* sideTaskError("Only a pending side task can be started.", { taskId });
    }
    const shell = yield* threads
      .getThreadShell(task.threadId)
      .pipe(
        Effect.mapError((cause) =>
          sideTaskError("Could not read the thread that found this task.", { taskId, cause }),
        ),
      );
    if (shell === null || shell.deletedAt !== null) {
      return yield* sideTaskError("The thread that found this task was deleted.", { taskId });
    }
    const workspaceStrategy = sideTaskWorkspaceStrategy(shell, workspace);
    if (workspaceStrategy === null) {
      return yield* sideTaskError("The thread that found this task has no branch for a worktree.", {
        taskId,
      });
    }
    // One command per task, so a repeated click resumes the same launch instead of starting twice.
    const commandId = CommandId.make(`command:side-task:${workspace}:${taskId}`);
    if (workspaceStrategy.type === "worktree") {
      yield* launches
        .checkWorktreeBase({ commandId, projectId: shell.projectId, workspaceStrategy })
        .pipe(Effect.mapError((error) => sideTaskError(error.message, { taskId, cause: error })));
    }
    const launched = yield* launches
      .launch({
        commandId,
        projectId: shell.projectId,
        title: task.title,
        modelSelection: shell.modelSelection,
        runtimeMode: shell.runtimeMode,
        interactionMode: shell.interactionMode,
        workspaceStrategy,
        initialMessage: { text: task.prompt, attachments: [] },
        createdBy: "user",
        creationSource: "web",
      })
      .pipe(Effect.mapError((error) => sideTaskError(error.message, { taskId, cause: error })));
    yield* setStatus(taskId, "started", launched.threadId);
    return launched.threadId;
  });

  const mutate: ThreadSideTaskService["Service"]["mutate"] = Effect.fn(
    "ThreadSideTaskService.mutate",
  )(function* (mutation) {
    if (mutation.type === "sideTask.start") {
      const startedThreadId = yield* start(mutation.taskId, mutation.workspace);
      return { ...(yield* list()), startedThreadId };
    }
    const task = yield* readTask(mutation.taskId);
    if (task.status === "started") {
      return yield* sideTaskError("A started side task cannot change.", {
        taskId: mutation.taskId,
      });
    }
    yield* setStatus(mutation.taskId, mutation.status, null);
    return yield* list();
  });

  return ThreadSideTaskService.of({ suggest, list, subscribeList, mutate });
});

export const layer = Layer.effect(ThreadSideTaskService, make);
