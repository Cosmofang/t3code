import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";

interface SplitThreadStoreState {
  /** The thread shown in a second column beside each thread, by that thread's key. */
  readonly byThreadKey: Readonly<Record<string, ThreadId>>;
  /** Shows `threadId` beside `host`, replacing any thread shown there. Never beside itself. */
  readonly open: (host: ScopedThreadRef, threadId: ThreadId) => void;
  readonly close: (host: ScopedThreadRef) => void;
}

export const useSplitThreadStore = create<SplitThreadStoreState>()(
  persist(
    (set) => ({
      byThreadKey: {},
      open: (host, threadId) => {
        if (host.threadId === threadId) return;
        set((state) => ({
          byThreadKey: { ...state.byThreadKey, [scopedThreadKey(host)]: threadId },
        }));
      },
      close: (host) =>
        set((state) => {
          const key = scopedThreadKey(host);
          if (!(key in state.byThreadKey)) return state;
          const { [key]: _closed, ...rest } = state.byThreadKey;
          return { byThreadKey: rest };
        }),
    }),
    {
      name: "t3code:split-thread:v1",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ byThreadKey: state.byThreadKey }),
    },
  ),
);
