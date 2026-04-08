import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  listHermesSkills,
  syncHermesSkills,
} from "../adapters/hermes-skills.js";

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("hermes local skill sync", () => {
  const paperclipKey = "paperclipai/paperclip/paperclip";
  const cleanupDirs = new Set<string>();

  afterEach(async () => {
    await Promise.all(Array.from(cleanupDirs).map((dir) => fs.rm(dir, { recursive: true, force: true })));
    cleanupDirs.clear();
  });

  it("reports desired Paperclip company skills alongside Hermes-installed skills", async () => {
    const home = await makeTempDir("paperclip-hermes-skill-sync-");
    cleanupDirs.add(home);

    await fs.mkdir(path.join(home, ".hermes", "skills", "software-development", "writing-plans"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(home, ".hermes", "skills", "software-development", "writing-plans", "SKILL.md"),
      `---
name: writing-plans
description: Hermes built-in planning skill
---
`,
      "utf8",
    );

    const ctx = {
      agentId: "agent-1",
      companyId: "company-1",
      adapterType: "hermes_local",
      config: {
        env: {
          HOME: home,
        },
        paperclipSkillSync: {
          desiredSkills: [paperclipKey],
        },
      },
    } as const;

    const before = await listHermesSkills(ctx);
    expect(before.mode).toBe("persistent");
    expect(before.desiredSkills).toContain(paperclipKey);
    expect(before.entries.find((entry) => entry.key === paperclipKey)?.required).toBe(true);
    expect(before.entries.find((entry) => entry.key === paperclipKey)?.state).toBe("configured");
    expect(before.entries.find((entry) => entry.key === "writing-plans")?.state).toBe("installed");
    expect(before.entries.find((entry) => entry.key === "writing-plans")?.readOnly).toBe(true);
  });

  it("keeps the same snapshot when sync is requested because Hermes manages loading at runtime", async () => {
    const home = await makeTempDir("paperclip-hermes-skill-sync-noop-");
    cleanupDirs.add(home);

    const ctx = {
      agentId: "agent-2",
      companyId: "company-1",
      adapterType: "hermes_local",
      config: {
        env: {
          HOME: home,
        },
        paperclipSkillSync: {
          desiredSkills: [paperclipKey],
        },
      },
    } as const;

    const before = await listHermesSkills(ctx);
    const after = await syncHermesSkills(ctx, [paperclipKey]);

    expect(after.desiredSkills).toEqual(before.desiredSkills);
    expect(after.entries.find((entry) => entry.key === paperclipKey)?.state).toBe("configured");
  });
});
