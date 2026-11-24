import type { BoardColumn } from "@t3tools/contracts";
import { useGT } from "gt-react";

export function useBoardColumnLabels(): Record<BoardColumn, string> {
  const gt = useGT();
  return {
    todo: gt("To do", { $context: "board column of work not started" }),
    doing: gt("In progress", { $context: "board column of work under way" }),
    review: gt("To review", { $context: "board column of work waiting for the user to check it" }),
    done: gt("Done", { $context: "board column of finished work" }),
  };
}

/** The dot before each column's name. */
export const BOARD_COLUMN_DOT: Record<BoardColumn, string> = {
  todo: "bg-muted-foreground",
  doing: "bg-info",
  review: "bg-warning",
  done: "bg-success",
};
