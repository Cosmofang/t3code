import type {
  OrchestrationV2PlanStep,
  ScopedThreadRef,
  ThreadId,
  ThreadSideTask,
  ThreadSideTaskMutation,
  ThreadSideTaskWorkspace,
} from "@t3tools/contracts";
import { useGT, useMessages } from "gt-react";
import {
  CheckIcon,
  ChevronDownIcon,
  CircleIcon,
  FileTextIcon,
  LoaderCircleIcon,
} from "lucide-react";
import * as Schema from "effect/Schema";
import { type ReactNode, useState } from "react";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { displayThreadTitle } from "../../lib/threadTitle";
import { cn } from "../../lib/utils";
import { useRightPanelStore } from "../../rightPanelStore";
import {
  useQuietThreadShell,
  useQuietThreadVisibleTurnItems,
  useThreadCheckpointSummaries,
} from "../../state/entities";
import { mutateThreadSideTasks, useThreadSideTasks } from "../../state/threadSideTasks";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import { THREAD_DETAILS_PANEL_ICON_CLASS } from "./threadDetailsPanelStyles";
import {
  type ChangedFile,
  latestPlanSteps,
  threadChangedFiles,
} from "./ThreadOverviewSections.logic";

const MAX_LISTED_FILES = 30;

const sectionCount = (text: string) => (
  <span className="text-2xs font-medium text-muted-foreground tabular-nums">{text}</span>
);

/** Whether a section is folded; one choice for every thread. */
function useSectionCollapsed(section: "progress" | "side-tasks" | "related-files") {
  return useLocalStorage(`t3code:thread-details:${section}-collapsed`, false, Schema.Boolean);
}

/** The heading's fold toggle; `children` (a count) stays visible while folded. */
function SectionFoldButton({
  title,
  collapsed,
  onToggle,
  children,
}: {
  readonly title: string;
  readonly collapsed: boolean;
  readonly onToggle: () => void;
  readonly children?: ReactNode;
}) {
  const gt = useGT();
  return (
    <button
      type="button"
      aria-expanded={!collapsed}
      aria-label={
        collapsed
          ? gt("Expand {section}", { section: title })
          : gt("Collapse {section}", { section: title })
      }
      onClick={onToggle}
      className="inline-flex h-6 cursor-pointer items-center gap-1 rounded-sm px-1 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      {children}
      <ChevronDownIcon
        aria-hidden
        className={cn("size-3.5 transition-transform", collapsed && "-rotate-90")}
      />
    </button>
  );
}

/** The agent's newest plan, finished steps checked and the running one marked. */
export function ThreadProgressSection({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const gt = useGT();
  const steps = latestPlanSteps(useQuietThreadVisibleTurnItems(threadRef));
  const [collapsed, setCollapsed] = useSectionCollapsed("progress");
  if (steps === null || steps.length === 0) return null;
  const done = steps.filter((step) => step.status === "completed").length;
  const title = gt("Progress");
  return (
    <ThreadDetailsSection
      headingId="thread-details-progress-heading"
      title={title}
      actions={
        <SectionFoldButton
          title={title}
          collapsed={collapsed}
          onToggle={() => setCollapsed(!collapsed)}
        >
          {sectionCount(`${done}/${steps.length}`)}
        </SectionFoldButton>
      }
    >
      {collapsed ? null : (
        <ol className="m-0 flex list-none flex-col gap-1.5 px-2.5 py-0.5">
          {steps.map((step) => (
            <PlanStepRow key={step.id} step={step} />
          ))}
        </ol>
      )}
    </ThreadDetailsSection>
  );
}

function PlanStepRow({ step }: { readonly step: OrchestrationV2PlanStep }) {
  return (
    <li className="flex items-start gap-2.5 text-sm leading-5">
      <span className="flex h-5 w-4 shrink-0 items-center justify-center">
        {step.status === "completed" ? (
          <span className="flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <CheckIcon className="size-3" strokeWidth={3} aria-hidden />
          </span>
        ) : step.status === "running" ? (
          <LoaderCircleIcon className="size-4 animate-spin text-primary" aria-hidden />
        ) : (
          <CircleIcon className="size-4 text-muted-foreground/60" aria-hidden />
        )}
      </span>
      <span
        className={cn(
          "min-w-0 break-words text-foreground/80",
          step.status === "completed" && "text-muted-foreground line-through decoration-1",
          step.status === "running" && "font-medium text-foreground",
        )}
      >
        {step.text}
      </span>
    </li>
  );
}

function startSideTask(
  threadRef: ScopedThreadRef,
  task: ThreadSideTask,
  workspace: ThreadSideTaskWorkspace,
  failureTitle: string,
) {
  return mutateThreadSideTasks(
    threadRef.environmentId,
    { type: "sideTask.start", taskId: task.id, workspace },
    failureTitle,
  );
}

/** Work the agent offered outside its task: start it in its own thread, or take it on here. */
export function ThreadSideTasksSection({
  threadRef,
  onDoItHere,
  onOpenThread,
}: {
  readonly threadRef: ScopedThreadRef;
  /** Puts a task's prompt in the composer; false when the composer cannot take it. */
  readonly onDoItHere: (prompt: string) => boolean;
  readonly onOpenThread: (threadId: ThreadId) => void;
}) {
  const gt = useGT();
  const tasks = useThreadSideTasks(threadRef).filter((task) => task.status !== "dismissed");
  const [collapsed, setCollapsed] = useSectionCollapsed("side-tasks");
  if (tasks.length === 0) return null;
  const pending = tasks.filter((task) => task.status === "pending");
  const title = gt("Side tasks");
  const pendingAction =
    pending.length > 1 ? (
      <ThreadDetailsControl
        size="xs"
        variant="ghost"
        part="meta"
        onClick={() => {
          for (const task of pending) {
            void startSideTask(threadRef, task, "same", gt("Could not start side task"));
          }
        }}
      >
        {gt("Start all")}
      </ThreadDetailsControl>
    ) : pending.length === 1 ? (
      sectionCount("1")
    ) : null;
  return (
    <ThreadDetailsSection
      headingId="thread-details-side-tasks-heading"
      title={title}
      actions={
        <>
          {pendingAction}
          <SectionFoldButton
            title={title}
            collapsed={collapsed}
            onToggle={() => setCollapsed(!collapsed)}
          />
        </>
      }
    >
      {collapsed ? null : (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {tasks.map((task) => (
            <SideTaskRow
              key={task.id}
              task={task}
              threadRef={threadRef}
              onDoItHere={onDoItHere}
              onOpenThread={onOpenThread}
            />
          ))}
        </ul>
      )}
    </ThreadDetailsSection>
  );
}

function SideTaskRow({
  task,
  threadRef,
  onDoItHere,
  onOpenThread,
}: {
  readonly task: ThreadSideTask;
  readonly threadRef: ScopedThreadRef;
  readonly onDoItHere: (prompt: string) => boolean;
  readonly onOpenThread: (threadId: ThreadId) => void;
}) {
  const gt = useGT();
  const [busy, setBusy] = useState(false);
  const run = async (mutation: Promise<unknown>) => {
    setBusy(true);
    try {
      await mutation;
    } finally {
      setBusy(false);
    }
  };
  const start = (workspace: ThreadSideTaskWorkspace) =>
    run(startSideTask(threadRef, task, workspace, gt("Could not start side task")));
  const setStatus = (
    status: Extract<ThreadSideTaskMutation, { type: "sideTask.setStatus" }>["status"],
  ) =>
    run(
      mutateThreadSideTasks(
        threadRef.environmentId,
        { type: "sideTask.setStatus", taskId: task.id, status },
        gt("Could not update side task"),
      ),
    );

  return (
    <li className="rounded-lg border border-border/60 px-2.5 py-2">
      {/* The prompt is what a new thread's agent reads, so it is one hover away. */}
      <Tooltip>
        <TooltipTrigger
          delay={400}
          render={<p className="text-sm font-medium leading-5 break-words text-foreground/85" />}
        >
          {task.title}
        </TooltipTrigger>
        <TooltipPopup side="left" className="max-w-sm whitespace-pre-wrap">
          {task.prompt}
        </TooltipPopup>
      </Tooltip>
      {task.reason !== null ? (
        <p className="mt-0.5 text-2xs leading-4 break-words text-muted-foreground">{task.reason}</p>
      ) : null}
      {task.status === "started" && task.startedThreadId !== null ? (
        <StartedTaskLink
          threadRef={{ environmentId: threadRef.environmentId, threadId: task.startedThreadId }}
          onOpenThread={onOpenThread}
        />
      ) : task.status === "here" ? (
        <div className="mt-1.5 flex items-center justify-between gap-2 text-2xs text-muted-foreground">
          <span>{gt("Handed to this thread")}</span>
          <Button
            variant="ghost-muted"
            size="micro"
            disabled={busy}
            onClick={() => void setStatus("pending")}
          >
            {gt("Undo")}
          </Button>
        </div>
      ) : (
        <div className="mt-2 flex items-center gap-1">
          <Button size="micro" disabled={busy} onClick={() => void start("same")}>
            {gt("Start")}
          </Button>
          <Button
            variant="ghost-muted"
            size="micro"
            disabled={busy}
            onClick={() => {
              if (onDoItHere(task.prompt)) void setStatus("here");
            }}
          >
            {gt("Do it here")}
          </Button>
          <Menu>
            <MenuTrigger
              render={
                <Button
                  variant="ghost-muted"
                  size="icon-micro"
                  disabled={busy}
                  aria-label={gt("More side task actions")}
                />
              }
            >
              <ChevronDownIcon />
            </MenuTrigger>
            <MenuPopup align="end">
              <MenuItem onClick={() => void start("worktree")}>
                {gt("Start in a new worktree")}
              </MenuItem>
              <MenuItem onClick={() => void setStatus("dismissed")}>{gt("Dismiss")}</MenuItem>
            </MenuPopup>
          </Menu>
        </div>
      )}
    </li>
  );
}

function StartedTaskLink({
  threadRef,
  onOpenThread,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly onOpenThread: (threadId: ThreadId) => void;
}) {
  const gt = useGT();
  const messages = useMessages();
  const shell = useQuietThreadShell(threadRef);
  const latestRun = shell?.latestRun ?? null;
  const working = latestRun !== null && latestRun.completedAt === null;
  return (
    <button
      type="button"
      className="mt-1.5 flex w-full min-w-0 items-center gap-1.5 rounded-md py-0.5 text-left text-2xs text-muted-foreground hover:text-foreground"
      onClick={() => onOpenThread(threadRef.threadId)}
    >
      {working ? (
        <LoaderCircleIcon className="size-3.5 shrink-0 animate-spin text-primary" aria-hidden />
      ) : (
        <CheckIcon className="size-3.5 shrink-0" aria-hidden />
      )}
      <span className="min-w-0 flex-1 truncate">
        {shell === null ? gt("Started") : displayThreadTitle(shell.title, messages)}
      </span>
      <span className="shrink-0">{working ? gt("Working") : gt("Open")}</span>
    </button>
  );
}

/** Every file the thread changed; a click opens it beside the chat. */
export function ThreadRelatedFilesSection({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const gt = useGT();
  const files = threadChangedFiles(useThreadCheckpointSummaries(threadRef));
  const [collapsed, setCollapsed] = useSectionCollapsed("related-files");
  // Showing every file lasts only for the thread it was chosen in.
  const threadKey = `${threadRef.environmentId}:${threadRef.threadId}`;
  const [showAllFor, setShowAllFor] = useState<string | null>(null);
  if (files.length === 0) return null;
  const showAll = showAllFor === threadKey;
  const listed = showAll ? files : files.slice(0, MAX_LISTED_FILES);
  const title = gt("Related files");
  return (
    <ThreadDetailsSection
      headingId="thread-details-related-files-heading"
      title={title}
      actions={
        <SectionFoldButton
          title={title}
          collapsed={collapsed}
          onToggle={() => setCollapsed(!collapsed)}
        >
          {sectionCount(String(files.length))}
        </SectionFoldButton>
      }
    >
      {collapsed ? null : (
        <>
          <ul className="m-0 list-none p-0">
            {listed.map((file) => (
              <ChangedFileRow key={file.path} file={file} threadRef={threadRef} />
            ))}
          </ul>
          {files.length > MAX_LISTED_FILES ? (
            <button
              type="button"
              onClick={() => setShowAllFor(showAll ? null : threadKey)}
              className="cursor-pointer px-2.5 pt-1 text-2xs text-muted-foreground outline-none hover:text-foreground focus-visible:underline"
            >
              {showAll
                ? gt("Show fewer")
                : gt("{count} more", { count: files.length - MAX_LISTED_FILES })}
            </button>
          ) : null}
        </>
      )}
    </ThreadDetailsSection>
  );
}

function ChangedFileRow({
  file,
  threadRef,
}: {
  readonly file: ChangedFile;
  readonly threadRef: ScopedThreadRef;
}) {
  const slash = file.path.lastIndexOf("/");
  const name = file.path.slice(slash + 1);
  const directory = slash > 0 ? file.path.slice(0, slash) : "";
  return (
    <li>
      <ThreadDetailsControl
        size="sm"
        variant="ghost"
        part="row"
        onClick={() => useRightPanelStore.getState().openFile(threadRef, file.path)}
      >
        <FileTextIcon aria-hidden className={THREAD_DETAILS_PANEL_ICON_CLASS} />
        <span className="shrink-0 truncate text-sm font-medium text-foreground/80">{name}</span>
        <span className="min-w-0 flex-1 truncate text-2xs text-muted-foreground">{directory}</span>
        <span className="shrink-0 text-2xs tabular-nums">
          {file.additions > 0 ? (
            <span className="text-success-foreground">+{file.additions}</span>
          ) : null}
          {file.deletions > 0 ? (
            <span className="ml-1 text-destructive-foreground">−{file.deletions}</span>
          ) : null}
        </span>
      </ThreadDetailsControl>
    </li>
  );
}
