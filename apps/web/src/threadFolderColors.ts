import type { ProjectIconColor, ProjectIconOverride, ThreadFolder } from "@t3tools/contracts";

// Neighbours differ in hue, so the first few folders are easy to tell apart. Gray stays for folders
// that ask for it.
const FOLDER_COLORS: ReadonlyArray<ProjectIconColor> = [
  "blue",
  "emerald",
  "amber",
  "rose",
  "violet",
  "cyan",
  "orange",
  "lime",
  "pink",
  "indigo",
  "teal",
  "yellow",
  "fuchsia",
  "sky",
  "green",
  "red",
  "purple",
];

/** The icon a folder has until someone customizes it: none, or the server's gray folder. */
function isDefaultFolderIcon(icon: ProjectIconOverride | null): boolean {
  return (
    icon === null || (icon.kind === "lucide" && icon.name === "folder" && icon.color === "gray")
  );
}

/**
 * Gives each uncustomized folder its own color, oldest first, skipping colors other folders
 * already chose. Colors repeat only past the palette's length.
 */
export function withDistinctFolderColors<T extends Pick<ThreadFolder, "icon" | "createdAt">>(
  folders: ReadonlyArray<T>,
): ReadonlyArray<T> {
  const taken = new Set<ProjectIconColor>();
  for (const folder of folders) {
    if (folder.icon !== null && folder.icon.kind !== "emoji" && !isDefaultFolderIcon(folder.icon)) {
      taken.add(folder.icon.color);
    }
  }
  const colors = new Map<T, ProjectIconColor>();
  let overflow = 0;
  for (const folder of folders
    .filter((candidate) => isDefaultFolderIcon(candidate.icon))
    .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt))) {
    const color =
      FOLDER_COLORS.find((candidate) => !taken.has(candidate)) ??
      FOLDER_COLORS[overflow++ % FOLDER_COLORS.length]!;
    taken.add(color);
    colors.set(folder, color);
  }
  if (colors.size === 0) return folders;
  return folders.map((folder) => {
    const color = colors.get(folder);
    return color === undefined
      ? folder
      : { ...folder, icon: { kind: "lucide", name: "folder", color } };
  });
}
