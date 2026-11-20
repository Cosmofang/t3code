import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// Like thread folders, side tasks live outside the numbered migrations so this fork never
// claims an upstream migration id. Upstream builds ignore the table.
export const ensureThreadSideTaskSchema = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Suggestions are offers to the user, not thread history, so they are plain rows.
  yield* sql`
    CREATE TABLE IF NOT EXISTS thread_side_tasks (
      task_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      reason TEXT,
      status TEXT NOT NULL,
      started_thread_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_thread_side_tasks_thread
    ON thread_side_tasks (thread_id)
  `;
});
