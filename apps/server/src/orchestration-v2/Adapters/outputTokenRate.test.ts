import { assert, describe, it } from "@effect/vitest";

import { outputTokensPerSecond } from "./outputTokenRate.ts";

describe("outputTokensPerSecond", () => {
  it("rounds tokens over the time from first output to last", () => {
    assert.strictEqual(outputTokensPerSecond(900, 12_000), 75);
    assert.strictEqual(outputTokensPerSecond(20, 500), 40);
  });

  it("skips requests too short to time", () => {
    assert.strictEqual(outputTokensPerSecond(19, 5_000), undefined);
    assert.strictEqual(outputTokensPerSecond(400, 499), undefined);
  });
});
