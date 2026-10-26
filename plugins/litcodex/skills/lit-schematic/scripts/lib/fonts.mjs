// Locates fonts for rendering. Pretendard ships beside this skill, in the LitCodex skills folder
// (unmodified official files under the OFL); lit-schematic reads it from there instead of carrying
// a second copy.

import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SKILL_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));

export function findPretendard() {
  const inPlugin = [
    join(SKILL_ROOT, "..", "lit-diagram-drawer", "assets", "fonts", "PretendardVariable.woff2"),
    join(SKILL_ROOT, "..", "lit-pptx", "pretendard-font", "public", "static", "Pretendard-Regular.otf"),
  ];
  for (const file of inPlugin) if (existsSync(file)) return { file, source: "litcodex" };
  const dirs = [join(homedir(), "Library", "Fonts"), "/Library/Fonts", join(homedir(), ".local", "share", "fonts"), "/usr/share/fonts", "C:\\Windows\\Fonts"];
  for (const dir of dirs) {
    try {
      const hit = readdirSync(dir).find((name) => /^Pretendard.*\.(?:otf|ttf|woff2)$/iu.test(name));
      if (hit) return { file: join(dir, hit), source: "system" };
    } catch {
      // directory absent on this platform
    }
  }
  return null;
}
