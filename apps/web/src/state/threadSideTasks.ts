import { useAtomValue } from "@effect/atom-react";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type ScopedThreadRef,
  type ThreadSideTask,
  type ThreadSideTaskListResult,
  type ThreadSideTaskMutation,
  type ThreadSideTaskMutationResult,
} from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";
import { msg } from "gt-react";

import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { m } from "../i18n/messages";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentServerConfigsAtom, serverEnvironment } from "./server";
import { readEnvironmentScope } from "./session";

const EMPTY_TASKS: ReadonlyArray<ThreadSideTask> = Object.freeze([]);
const EMPTY_TASKS_ATOM = Atom.make(EMPTY_TASKS).pipe(Atom.withLabel("web-thread-side-tasks:none"));

/** An environment's side tasks, newest first; environments without the feature never subscribe. */
const environmentSideTasksAtomFamily = Atom.family((environmentId: EnvironmentId) => {
  let previousList: ThreadSideTaskListResult | null = null;
  let previous = EMPTY_TASKS;
  return Atom.make((get) => {
    const config = get(environmentServerConfigsAtom).get(environmentId);
    if (config?.environment.capabilities.threadSideTasks !== true) return EMPTY_TASKS;
    const result = get(serverEnvironment.threadSideTasksLive({ environmentId, input: {} }));
    if (!AsyncResult.isSuccess(result) || result.value === previousList) return previous;
    previousList = result.value;
    previous = result.value.tasks;
    return previous;
  }).pipe(Atom.withLabel(`web-thread-side-tasks:${environmentId}`));
});

/** The side tasks a thread's agent found, oldest first, as the agent offered them. */
export function useThreadSideTasks(ref: ScopedThreadRef | null): ReadonlyArray<ThreadSideTask> {
  const tasks = useAtomValue(
    ref === null ? EMPTY_TASKS_ATOM : environmentSideTasksAtomFamily(ref.environmentId),
  );
  if (ref === null) return EMPTY_TASKS;
  return tasks.filter((task) => task.threadId === ref.threadId).reverse();
}

/** Runs one side task change and toasts on failure; resolves to the result, or null. */
export async function mutateThreadSideTasks(
  environmentId: EnvironmentId,
  mutation: ThreadSideTaskMutation,
  failureTitle: string,
): Promise<ThreadSideTaskMutationResult | null> {
  if (!readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)) {
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title: failureTitle,
        description: m(msg("This connection cannot change side tasks.")),
      }),
    );
    return null;
  }
  const result: AtomCommandResult<ThreadSideTaskMutationResult, unknown> = await runAtomCommand(
    appAtomRegistry,
    serverEnvironment.mutateThreadSideTasks,
    { environmentId, input: mutation },
    { label: "thread side tasks", reportFailure: false },
  );
  if (result._tag === "Success") return result.value;
  if (!isAtomCommandInterrupted(result)) {
    const failure = squashAtomCommandFailure(result);
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title: failureTitle,
        description: failure instanceof Error ? failure.message : String(failure),
      }),
    );
  }
  return null;
}

export interface EnvironmentSideTask extends ThreadSideTask {
  readonly environmentId: EnvironmentId;
}

let previousAllInputs: ReadonlyArray<ReadonlyArray<ThreadSideTask>> = [];
let previousAll: ReadonlyArray<EnvironmentSideTask> = [];

/** Every connected environment's side tasks, newest first. */
const allSideTasksAtom = Atom.make((get) => {
  const environmentIds = [...get(environmentServerConfigsAtom).keys()];
  const lists = environmentIds.map((id) => get(environmentSideTasksAtomFamily(id)));
  if (
    lists.length === previousAllInputs.length &&
    lists.every((list, index) => list === previousAllInputs[index])
  ) {
    return previousAll;
  }
  previousAllInputs = lists;
  previousAll = lists.flatMap((list, index) =>
    list.map((task) => ({ ...task, environmentId: environmentIds[index]! })),
  );
  return previousAll;
}).pipe(Atom.withLabel("web-thread-side-tasks:all"));

export function useAllSideTasks(): ReadonlyArray<EnvironmentSideTask> {
  return useAtomValue(allSideTasksAtom);
}
