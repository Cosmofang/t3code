// Fork: a model request's output speed for the composer. Requests that finish within a moment
// are too short to time, so they report nothing and the last timed speed stays.
export function outputTokensPerSecond(outputTokens: number, elapsedMs: number): number | undefined {
  if (outputTokens < 20 || elapsedMs < 500) return undefined;
  return Math.round((outputTokens * 1000) / elapsedMs);
}
