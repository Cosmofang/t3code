import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useMessages } from "gt-react";
import { XIcon } from "lucide-react";
import { Atom } from "effect/reactivity";

import { useNowMinute } from "../../hooks/useNowMinute";
import { displayThreadTitle } from "../../lib/threadTitle";
import { cn } from "../../lib/utils";
import {
  deriveProviderEntriesByEnvironment,
  type ProviderInstanceEntry,
} from "../../providerInstances";
import { environmentPresentations } from "../../state/presentation";
import { useQuietThreadShell } from "../../state/entities";
import { formatElapsedDurationLabel } from "../../timestampFormat";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { resolveThreadStatusPill, resolveWorkingStartedAt } from "../Sidebar.logic";

const providerEntriesAtom = Atom.make((get) => {
  const providersByEnvironment = get(environmentPresentations.providersByEnvironmentAtom);
  return deriveProviderEntriesByEnvironment(
    [...get(environmentPresentations.serverConfigsAtom)].map(
      ([environmentId, config]) =>
        [environmentId, providersByEnvironment.get(environmentId) ?? [], config.settings] as const,
    ),
  );
}).pipe(Atom.withLabel("board-provider-entries"));

function useProviderEntry(
  environmentId: EnvironmentId,
  instanceId: string | null,
): ProviderInstanceEntry | null {
  const entries = useAtomValue(providerEntriesAtom);
  if (instanceId === null) return null;
  return entries.get(environmentId)?.get(instanceId) ?? null;
}

/** One attached thread: its agent, title and what it is doing now. */
export function BoardThreadRow({
  environmentId,
  threadId,
  onOpen,
  onRemove,
  removeLabel,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly onOpen: () => void;
  readonly onRemove?: (() => void) | undefined;
  readonly removeLabel?: string | undefined;
}) {
  const messages = useMessages();
  const nowMinute = useNowMinute();
  const shell = useQuietThreadShell(scopeThreadRef(environmentId, threadId));
  const instanceId = shell
    ? (shell.runtime?.providerInstanceId ?? shell.modelSelection.instanceId)
    : null;
  const entry = useProviderEntry(environmentId, instanceId);
  if (shell === null) return null;
  const pill = resolveThreadStatusPill({ thread: shell });
  const workingSince = pill?.pulse ? resolveWorkingStartedAt(shell) : null;
  return (
    <div className="group/thread flex min-w-0 items-center gap-1.5">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onOpen();
        }}
        onPointerDown={(event) => event.stopPropagation()}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-sm text-left text-2xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        {entry ? (
          <ProviderInstanceIcon
            driverKind={entry.driverKind}
            displayName={entry.displayName}
            accentColor={entry.accentColor}
            acpRegistryAgentId={entry.acpRegistryAgentId}
            acpRegistryIconUrl={entry.acpRegistryIconUrl}
            size="compact"
            iconClassName="size-3.5"
          />
        ) : null}
        <span className="min-w-0 flex-1 truncate">{displayThreadTitle(shell.title, messages)}</span>
        {pill ? (
          <span className={cn("flex shrink-0 items-center gap-1", pill.colorClass)}>
            <span
              aria-hidden
              className={cn("size-1.5 rounded-full", pill.dotClass, pill.pulse && "animate-pulse")}
            />
            {workingSince
              ? formatElapsedDurationLabel(workingSince, Date.parse(nowMinute), messages)
              : messages(pill.label)}
          </span>
        ) : null}
      </button>
      {onRemove ? (
        <button
          type="button"
          aria-label={removeLabel}
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          className="shrink-0 cursor-pointer rounded-sm p-0.5 text-muted-foreground opacity-0 outline-none group-hover/thread:opacity-100 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          <XIcon className="size-3" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
