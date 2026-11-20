import { msg } from "gt-react";

import type { MessageResolver } from "../i18n/messages";

/** The server stores this English title on threads until their first message names them. */
const DEFAULT_THREAD_TITLE = "New thread";

/** A thread's title for display: the stored default shows in the UI language; renames keep the raw title. */
export function displayThreadTitle(title: string, resolve: MessageResolver): string {
  return title === DEFAULT_THREAD_TITLE ? resolve(msg("New thread")) : title;
}
