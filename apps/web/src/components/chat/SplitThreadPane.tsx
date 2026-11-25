import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { XIcon } from "lucide-react";
import { useEffect } from "react";

import { ComposerHandleContext } from "../../composerHandleContext";
import type { SideChatParentPanel } from "../../lib/sideChatPane";
import { hostRightPanel } from "../../rightPanelStore";
import { useQuietThreadShell } from "../../state/entities";
import { useEnvironmentShellHasSnapshot } from "../../state/shell";
import ChatView from "../ChatView";
import { Button } from "../ui/button";
import { BackgroundThreadContext } from "./backgroundThread";

/**
 * Another thread shown beside the main one: its title and Close over its own chat. Closing only
 * closes the tab; the thread stays in the sidebar.
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
    // The side chat marker keeps this pane's keys, scrolling and focus apart from the main thread's.
    <div data-side-chat-pane={threadId} className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border pr-1 pl-3">
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {shell?.title ?? gt("Thread")}
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={gt("Close split view")}
          onClick={props.onClose}
        >
          <XIcon />
        </Button>
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
