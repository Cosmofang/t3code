import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { useGT, useMessages } from "gt-react";
import { BotIcon, ChevronDownIcon } from "lucide-react";
import { useState } from "react";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { displayThreadTitle } from "../../lib/threadTitle";
import { cn } from "../../lib/utils";
import { mutateBoard, newBoardCardId } from "../../state/board";
import { useQuietThreadShell } from "../../state/entities";
import { type EnvironmentSideTask, mutateThreadSideTasks } from "../../state/threadSideTasks";
import { Button } from "../ui/button";

function SuggestionRow({
  task,
  onOpenThread,
}: {
  readonly task: EnvironmentSideTask;
  readonly onOpenThread: (ref: ScopedThreadRef) => void;
}) {
  const gt = useGT();
  const messages = useMessages();
  const ref = scopeThreadRef(task.environmentId, task.threadId);
  const shell = useQuietThreadShell(ref);
  const [busy, setBusy] = useState(false);
  const take = async () => {
    setBusy(true);
    const details = task.reason === null ? task.prompt : `${task.prompt}\n\n> ${task.reason}`;
    await mutateBoard(
      task.environmentId,
      {
        type: "card.create",
        cardId: newBoardCardId(),
        title: task.title,
        details,
        projectId: shell?.projectId ?? null,
        sideTaskId: task.id,
      },
      gt("Could not add the suggestion to the board"),
    );
    setBusy(false);
  };
  const dismiss = async () => {
    setBusy(true);
    await mutateThreadSideTasks(
      task.environmentId,
      { type: "sideTask.setStatus", taskId: task.id, status: "dismissed" },
      gt("Could not update side task"),
    );
    setBusy(false);
  };
  return (
    <li className="rounded-lg border border-dashed border-border px-2.5 py-2">
      <button
        type="button"
        onClick={() => onOpenThread(ref)}
        className="block w-full cursor-pointer truncate text-left text-2xs text-muted-foreground outline-none hover:text-foreground focus-visible:underline"
      >
        {gt("From “{thread}”", {
          thread: shell ? displayThreadTitle(shell.title, messages) : gt("a thread"),
        })}
      </button>
      <p className="mt-0.5 text-sm leading-5 font-medium break-words text-foreground/85">
        {task.title}
      </p>
      <div className="mt-1.5 flex items-center gap-1">
        <Button size="micro" disabled={busy} onClick={() => void take()}>
          {gt("Add to board")}
        </Button>
        <Button size="micro" variant="ghost-muted" disabled={busy} onClick={() => void dismiss()}>
          {gt("Dismiss")}
        </Button>
      </div>
    </li>
  );
}

/** Agents' side-task suggestions from every thread, waiting to become cards. */
export function BoardSuggestions({
  tasks,
  onOpenThread,
}: {
  readonly tasks: ReadonlyArray<EnvironmentSideTask>;
  readonly onOpenThread: (ref: ScopedThreadRef) => void;
}) {
  const gt = useGT();
  const [collapsed, setCollapsed] = useLocalStorage(
    "t3code:board:suggestions-collapsed",
    false,
    Schema.Boolean,
  );
  if (tasks.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed(!collapsed)}
        className="flex cursor-pointer items-center gap-1.5 rounded-sm text-2xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <BotIcon className="size-3" aria-hidden />
        {gt("Agent suggestions")}
        <span className="tabular-nums">{tasks.length}</span>
        <ChevronDownIcon
          aria-hidden
          className={cn("ml-auto size-3 transition-transform", collapsed && "-rotate-90")}
        />
      </button>
      {collapsed ? null : (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {tasks.map((task) => (
            <SuggestionRow
              key={`${task.environmentId}:${task.id}`}
              task={task}
              onOpenThread={onOpenThread}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
