import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { type EnvironmentId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { useSplitThreadStore } from "./splitThreadStore";

const refA = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-A"));

beforeEach(() => {
  useSplitThreadStore.setState({ byThreadKey: {} });
});

describe("splitThreadStore", () => {
  it("shows one thread beside another, replaces it, and closes it", () => {
    const store = useSplitThreadStore.getState();
    store.open(refA, ThreadId.make("thread-B"));
    store.open(refA, ThreadId.make("thread-C"));
    expect(useSplitThreadStore.getState().byThreadKey).toEqual({ "env-1:thread-A": "thread-C" });
    store.close(refA);
    expect(useSplitThreadStore.getState().byThreadKey).toEqual({});
  });

  it("never shows a thread beside itself", () => {
    useSplitThreadStore.getState().open(refA, refA.threadId);
    expect(useSplitThreadStore.getState().byThreadKey).toEqual({});
  });
});
