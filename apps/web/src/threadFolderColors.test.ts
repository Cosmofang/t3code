import type { ProjectIconOverride } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { withDistinctFolderColors } from "./threadFolderColors";

const folder = (createdAt: string, icon: ProjectIconOverride | null = null) => ({
  createdAt,
  icon,
});
const gray: ProjectIconOverride = { kind: "lucide", name: "folder", color: "gray" };

describe("withDistinctFolderColors", () => {
  it("colors default folders oldest first, skipping colors other folders chose", () => {
    const chosen = folder("2026-11-02", { kind: "lucide", name: "rocket", color: "blue" });
    const colors = withDistinctFolderColors([
      folder("2026-11-03", gray),
      chosen,
      folder("2026-11-01"),
    ]).map((entry) => (entry.icon?.kind === "lucide" ? entry.icon.color : null));
    expect(colors).toEqual(["amber", "blue", "emerald"]);
  });

  it("keeps a chosen gray icon and every customized folder as it is", () => {
    const grayRocket = folder("2026-11-01", { kind: "lucide", name: "rocket", color: "gray" });
    const emoji = folder("2026-11-02", { kind: "emoji", emoji: "🚀" });
    const folders = [grayRocket, emoji];
    expect(withDistinctFolderColors(folders)).toBe(folders);
  });

  it("repeats colors only once the palette runs out", () => {
    const colors = withDistinctFolderColors(
      Array.from({ length: 19 }, (_, index) =>
        folder(`2026-11-${String(index + 1).padStart(2, "0")}`),
      ),
    ).map((entry) => (entry.icon?.kind === "lucide" ? entry.icon.color : null));
    expect(new Set(colors.slice(0, 17)).size).toBe(17);
    expect(colors.slice(17)).toEqual(["blue", "emerald"]);
  });
});
