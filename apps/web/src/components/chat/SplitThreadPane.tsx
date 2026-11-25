import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { XIcon } from "lucide-react";
import { useEffect } from "react";

import { ComposerHandleContext } from "../../composerHandleContext";
import { isElectron } from "../../env";
import type { SideChatParentPanel } from "../../lib/sideChatPane";
import { cn } from "../../lib/utils";
import { hostRightPanel } from "../../rightPanelStore";
import { useQuietThreadShell } from "../../state/entities";
import { useEnvironmentShellHasSnapshot } from "../../state/shell";
import ChatView from "../ChatView";
import { Button } from "../ui/button";
import { BackgroundThreadContext } from "./backgroundThread";

/**
 * Another thread in a second column beside the main one, left of the right panel. Its panel
 * actions open in the main thread's panel. Closing only closes the column.
 */
export default function SplitThreadPane(props: {
  readonly hostRef: ScopedThreadRef;
  readonly threadId: ThreadId;
  readonly hostPanel: SideChatParentPanel;
  readonly onClose: () => void;
}) {
  const { hostRef, threadId } = props;
  const gt = useGT();
  const threadRef = scopeThreadRef(hostRef.environmentId, threadId);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers the host panel in the panel store
  useEffect(
    () => hostRightPanel(scopeThreadRef(hostRef.environmentId, threadId), hostRef),
    [hostRef, threadId],
  );
  const shell = useQuietThreadShell(threadRef);
  const snapshotLoaded = useEnvironmentShellHasSnapshot(hostRef.environmentId);

  return (
    // The side chat marker keeps this column's keys, scrolling and focus apart from the main thread's.
    <div
      data-side-chat-pane={threadId}
      className="flex min-h-0 min-w-0 flex-1 flex-col border-l border-border bg-background"
    >
      {/* Close sits left: with the panel closed, the window's panel controls cover the right end. */}
      <div
        className={cn(
          "flex h-[var(--workspace-topbar-height)] min-h-[var(--workspace-topbar-height)] shrink-0 items-center gap-1 border-b border-border pr-3 pl-1",
          isElectron && "drag-region",
        )}
      >
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={gt("Close split view")}
          onClick={props.onClose}
        >
          <XIcon />
        </Button>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {shell?.title ?? gt("Thread")}
        </span>
      </div>
      {shell === null ? (
        snapshotLoaded ? (
          <p className="p-3 text-xs text-muted-foreground">
            <T>This thread is no longer available.</T>
          </p>
        ) : null
      ) : (
        <BackgroundThreadContext value>
          <ComposerHandleContext value={null}>
            <ChatView
              environmentId={hostRef.environmentId}
              threadId={threadId}
              routeKind="server"
              embedded={props.hostPanel}
            />
          </ComposerHandleContext>
        </BackgroundThreadContext>
      )}
    </div>
  );
}
