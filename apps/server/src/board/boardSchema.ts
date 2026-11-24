import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// Like thread folders and side tasks, the board lives outside the numbered migrations so this
// fork never claims an upstream migration id. Upstream builds ignore the tables.
export const ensureBoardSchema = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS board_cards (
      card_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '',
      column_key TEXT NOT NULL,
      project_id TEXT,
      due_date TEXT,
      pinned INTEGER NOT NULL DEFAULT 0,
      sort_order REAL,
      side_task_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      archived_at TEXT
    )
  `;
  // The thread is the key: a thread sits on at most one card.
  yield* sql`
    CREATE TABLE IF NOT EXISTS board_card_threads (
      thread_id TEXT PRIMARY KEY,
      card_id TEXT NOT NULL,
      attached_at TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_board_card_threads_card
    ON board_card_threads (card_id)
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS board_prefs (
      pref_key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `;
});
