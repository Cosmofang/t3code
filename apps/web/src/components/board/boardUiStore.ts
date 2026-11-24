import type { BoardCardId, EnvironmentId } from "@t3tools/contracts";
import { create } from "zustand";

export interface BoardCardKey {
  readonly environmentId: EnvironmentId;
  readonly cardId: BoardCardId;
}

/**
 * Board view state shared by the page and every thread's panel, so switching threads keeps the
 * open card, the chosen day and the filter. It lasts for the session only.
 */
interface BoardUiState {
  readonly openCard: BoardCardKey | null;
  readonly selectedDay: string | null;
  /** A project key ("environmentId:projectId"), "none" for unfiled cards, or null for all. */
  readonly projectFilter: string | null;
  readonly showArchive: boolean;
  readonly showOlderDone: boolean;
  openCardDetail: (key: BoardCardKey | null) => void;
  selectDay: (day: string | null) => void;
  setProjectFilter: (filter: string | null) => void;
  setShowArchive: (show: boolean) => void;
  setShowOlderDone: (show: boolean) => void;
}

export const useBoardUiStore = create<BoardUiState>((set) => ({
  openCard: null,
  selectedDay: null,
  projectFilter: null,
  showArchive: false,
  showOlderDone: false,
  openCardDetail: (key) => set({ openCard: key }),
  selectDay: (day) => set({ selectedDay: day }),
  setProjectFilter: (filter) => set({ projectFilter: filter }),
  setShowArchive: (show) => set({ showArchive: show, openCard: null }),
  setShowOlderDone: (show) => set({ showOlderDone: show }),
}));

export const sameCardKey = (a: BoardCardKey | null, b: BoardCardKey | null) =>
  a !== null && b !== null && a.environmentId === b.environmentId && a.cardId === b.cardId;

export const cardKeyString = (key: BoardCardKey) => `${key.environmentId}|${key.cardId}`;
