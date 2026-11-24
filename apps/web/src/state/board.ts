import { useAtomValue } from "@effect/atom-react";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  type BoardCard,
  BoardCardId,
  type BoardListResult,
  type BoardMutation,
  type EnvironmentId,
} from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";
import { msg } from "gt-react";

import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { m } from "../i18n/messages";
import { randomUUID } from "../lib/utils";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentServerConfigsAtom, serverEnvironment } from "./server";
import { readEnvironmentScope } from "./session";

/** A card and the environment that keeps it. */
export interface EnvironmentBoardCard extends BoardCard {
  readonly environmentId: EnvironmentId;
}

interface EnvironmentBoard {
  readonly cards: ReadonlyArray<EnvironmentBoardCard>;
  readonly autoFlow: boolean;
  readonly loaded: boolean;
}

const EMPTY_BOARD: EnvironmentBoard = Object.freeze({ cards: [], autoFlow: true, loaded: false });

/** An environment's board; environments without the feature never subscribe. */
const environmentBoardAtomFamily = Atom.family((environmentId: EnvironmentId) => {
  let previousList: BoardListResult | null = null;
  let previous = EMPTY_BOARD;
  return Atom.make((get): EnvironmentBoard => {
    const config = get(environmentServerConfigsAtom).get(environmentId);
    if (config?.environment.capabilities.board !== true) return EMPTY_BOARD;
    const result = get(serverEnvironment.boardLive({ environmentId, input: {} }));
    if (!AsyncResult.isSuccess(result) || result.value === previousList) return previous;
    previousList = result.value;
    previous = {
      cards: result.value.cards.map((card) => ({ ...card, environmentId })),
      autoFlow: result.value.autoFlow,
      loaded: true,
    };
    return previous;
  }).pipe(Atom.withLabel(`web-board:${environmentId}`));
});

/** Environments whose server keeps a board, in connection order. */
const boardEnvironmentIdsAtom = Atom.make((get) => {
  const ids: Array<EnvironmentId> = [];
  for (const [environmentId, config] of get(environmentServerConfigsAtom)) {
    if (config.environment.capabilities.board === true) ids.push(environmentId);
  }
  return ids;
}).pipe(Atom.withLabel("web-board:environments"));

let previousIds: ReadonlyArray<EnvironmentId> = [];
let previousBoards: ReadonlyArray<EnvironmentBoard> = [];
let previousMerged: {
  cards: ReadonlyArray<EnvironmentBoardCard>;
  environmentIds: ReadonlyArray<EnvironmentId>;
  autoFlow: boolean;
  loaded: boolean;
} = { cards: [], environmentIds: [], autoFlow: true, loaded: false };

const boardAtom = Atom.make((get) => {
  const ids = get(boardEnvironmentIdsAtom);
  const boards = ids.map((id) => get(environmentBoardAtomFamily(id)));
  const sameIds = ids.length === previousIds.length && ids.every((id, i) => id === previousIds[i]);
  const sameBoards =
    boards.length === previousBoards.length && boards.every((b, i) => b === previousBoards[i]);
  if (sameIds && sameBoards) return previousMerged;
  previousIds = ids;
  previousBoards = boards;
  previousMerged = {
    cards: boards.flatMap((board) => board.cards),
    environmentIds: ids,
    // The switch is per server; the first one speaks for the board.
    autoFlow: boards[0]?.autoFlow ?? true,
    loaded: boards.length > 0 && boards.every((board) => board.loaded),
  };
  return previousMerged;
}).pipe(Atom.withLabel("web-board:all"));

/** Every connected board's cards, archived ones included. */
export function useBoard() {
  return useAtomValue(boardAtom);
}

export function useBoardSupported(): boolean {
  return useAtomValue(boardEnvironmentIdsAtom).length > 0;
}

export function newBoardCardId() {
  return BoardCardId.make(`card:${randomUUID()}`);
}

/** Runs one board change and toasts on failure; resolves to true when it landed. */
export async function mutateBoard(
  environmentId: EnvironmentId,
  mutation: BoardMutation,
  failureTitle: string,
): Promise<boolean> {
  if (!readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)) {
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title: failureTitle,
        description: m(msg("This connection cannot change the board.")),
      }),
    );
    return false;
  }
  const result: AtomCommandResult<BoardListResult, unknown> = await runAtomCommand(
    appAtomRegistry,
    serverEnvironment.mutateBoard,
    { environmentId, input: mutation },
    { label: "board", reportFailure: false },
  );
  if (result._tag === "Success") return true;
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
  return false;
}

/** The merged board, read outside React (menus, commands). */
export function readBoard() {
  return appAtomRegistry.get(boardAtom);
}
