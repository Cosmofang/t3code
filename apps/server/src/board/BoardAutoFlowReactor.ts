import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import { forkParked } from "../serverActivation.ts";
import * as BoardService from "./BoardService.ts";

/** Moves a card between doing and review as its threads start and stop. */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const engine = yield* Orchestrator.OrchestratorV2;
    const board = yield* BoardService.BoardService;
    yield* forkParked(
      Stream.runForEach(engine.streamDomainEvents, (event) => {
        switch (event.type) {
          case "run.created":
          case "run.updated":
          case "runtime-request.updated":
            return board.syncThread(event.threadId).pipe(
              Effect.catchCauseIf(
                (cause) => !Cause.hasInterruptsOnly(cause),
                (cause) =>
                  Effect.logWarning("board auto flow skipped", { threadId: event.threadId, cause }),
              ),
            );
          default:
            return Effect.void;
        }
      }).pipe(
        Effect.catchCauseIf(
          (cause) => !Cause.hasInterruptsOnly(cause),
          (cause) => Effect.logWarning("board auto flow event stream failed", { cause }),
        ),
      ),
    );
  }),
);
