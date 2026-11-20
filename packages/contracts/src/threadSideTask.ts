import * as Schema from "effect/Schema";

import {
  ForwardCompatibleArray,
  IsoDateTime,
  ThreadId,
  ThreadSideTaskId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";

/** Pending tasks one thread may hold; an agent past it is asked to finish or drop some first. */
export const MAX_PENDING_THREAD_SIDE_TASKS = 20;

export const ThreadSideTaskTitle = TrimmedNonEmptyString.check(Schema.isMaxLength(120));
export const ThreadSideTaskPrompt = TrimmedNonEmptyString.check(Schema.isMaxLength(20_000));
export const ThreadSideTaskReason = TrimmedNonEmptyString.check(Schema.isMaxLength(500));

/**
 * pending: waiting for the user. started: running in its own thread. here: sent to the thread
 * that found it. dismissed: the user passed on it.
 */
export const ThreadSideTaskStatus = Schema.Literals(["pending", "started", "here", "dismissed"]);
export type ThreadSideTaskStatus = typeof ThreadSideTaskStatus.Type;

/** Work an agent noticed outside its own task, offered to the user to start elsewhere. */
export const ThreadSideTask = Schema.Struct({
  id: ThreadSideTaskId,
  /** The thread whose agent found it. */
  threadId: ThreadId,
  title: ThreadSideTaskTitle,
  /** What a new thread's agent is told; it stands alone. */
  prompt: ThreadSideTaskPrompt,
  reason: Schema.NullOr(ThreadSideTaskReason),
  status: ThreadSideTaskStatus,
  startedThreadId: Schema.NullOr(ThreadId),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ThreadSideTask = typeof ThreadSideTask.Type;

export const ThreadSideTaskListInput = Schema.Struct({});
export type ThreadSideTaskListInput = typeof ThreadSideTaskListInput.Type;

export const ThreadSideTaskListResult = Schema.Struct({
  tasks: ForwardCompatibleArray(ThreadSideTask),
});
export type ThreadSideTaskListResult = typeof ThreadSideTaskListResult.Type;

/** same: the finding thread's checkout. worktree: a new worktree from the finding thread's branch. */
export const ThreadSideTaskWorkspace = Schema.Literals(["same", "worktree"]);
export type ThreadSideTaskWorkspace = typeof ThreadSideTaskWorkspace.Type;

export const ThreadSideTaskMutation = Schema.Union([
  Schema.Struct({
    // Launches a thread with the task's prompt and the finding thread's model and modes.
    type: Schema.Literal("sideTask.start"),
    taskId: ThreadSideTaskId,
    workspace: ThreadSideTaskWorkspace,
  }),
  Schema.Struct({
    type: Schema.Literal("sideTask.setStatus"),
    taskId: ThreadSideTaskId,
    status: Schema.Literals(["pending", "here", "dismissed"]),
  }),
]);
export type ThreadSideTaskMutation = typeof ThreadSideTaskMutation.Type;

export const ThreadSideTaskMutationResult = Schema.Struct({
  tasks: ForwardCompatibleArray(ThreadSideTask),
  startedThreadId: Schema.optional(ThreadId),
});
export type ThreadSideTaskMutationResult = typeof ThreadSideTaskMutationResult.Type;

export class ThreadSideTaskError extends Schema.TaggedError<ThreadSideTaskError>()(
  "ThreadSideTaskError",
  {
    message: Schema.String,
    taskId: Schema.optional(ThreadSideTaskId),
    cause: Schema.optional(Schema.Defect()),
  },
) {}
