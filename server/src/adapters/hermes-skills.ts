import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AdapterSkillContext,
  AdapterSkillEntry,
  AdapterSkillSnapshot,
} from "@paperclipai/adapter-utils";
import {
  readPaperclipRuntimeSkillEntries,
  resolvePaperclipDesiredSkillNames,
} from "@paperclipai/adapter-utils/server-utils";

const __moduleDir = path.dirname(fileURLToPath(import.meta.url));
// Temporary bridge until hermes-paperclip-adapter resolves the Paperclip repo skill root
// when loaded from node_modules. Once upstream supports that natively, this wrapper can go away.
const PAPERCLIP_SERVER_SKILLS_DIR = path.resolve(__moduleDir, "../../../skills");

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function resolveHermesHome(config: Record<string, unknown>) {
  const env =
    typeof config.env === "object" && config.env !== null && !Array.isArray(config.env)
      ? (config.env as Record<string, unknown>)
      : {};
  const configuredHome = asString(env.HOME);
  return configuredHome ? path.resolve(configuredHome) : os.homedir();
}

function parseSkillFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return {};

  const frontmatter: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    frontmatter[key] = value;
  }
  return frontmatter;
}

async function buildHermesInstalledSkillEntry(
  key: string,
  skillMdPath: string,
  categoryPath: string,
): Promise<AdapterSkillEntry> {
  let description: string | null = null;
  try {
    const content = await fs.readFile(skillMdPath, "utf8");
    description = parseSkillFrontmatter(content).description ?? null;
  } catch {
    // Ignore malformed external skill metadata.
  }

  return {
    key,
    runtimeName: key,
    desired: true,
    managed: false,
    state: "installed",
    origin: "user_installed",
    originLabel: "Hermes skill",
    locationLabel: `~/.hermes/skills/${categoryPath}`,
    readOnly: true,
    sourcePath: skillMdPath,
    targetPath: null,
    detail: description,
  };
}

async function scanHermesInstalledSkills(skillsHome: string): Promise<AdapterSkillEntry[]> {
  const entries: AdapterSkillEntry[] = [];
  try {
    const categories = await fs.readdir(skillsHome, { withFileTypes: true });
    for (const category of categories) {
      if (!category.isDirectory()) continue;
      const categoryPath = path.join(skillsHome, category.name);

      const topLevelSkillMd = path.join(categoryPath, "SKILL.md");
      if (await fs.stat(topLevelSkillMd).catch(() => null)) {
        entries.push(await buildHermesInstalledSkillEntry(category.name, topLevelSkillMd, category.name));
      }

      const children = await fs.readdir(categoryPath, { withFileTypes: true }).catch(() => []);
      for (const child of children) {
        if (!child.isDirectory()) continue;
        const skillMd = path.join(categoryPath, child.name, "SKILL.md");
        if (!(await fs.stat(skillMd).catch(() => null))) continue;
        entries.push(
          await buildHermesInstalledSkillEntry(child.name, skillMd, `${category.name}/${child.name}`),
        );
      }
    }
  } catch {
    // Hermes skill home is optional.
  }

  return entries.sort((left, right) => left.key.localeCompare(right.key));
}

async function buildHermesSkillSnapshot(
  config: Record<string, unknown>,
): Promise<AdapterSkillSnapshot> {
  const hermesSkillsHome = path.join(resolveHermesHome(config), ".hermes", "skills");
  const paperclipEntries = await readPaperclipRuntimeSkillEntries(
    config,
    __moduleDir,
    [PAPERCLIP_SERVER_SKILLS_DIR],
  );
  const desiredSkills = resolvePaperclipDesiredSkillNames(config, paperclipEntries);
  const desiredSet = new Set(desiredSkills);
  const availableByKey = new Map(paperclipEntries.map((entry) => [entry.key, entry]));
  const hermesEntries = await scanHermesInstalledSkills(hermesSkillsHome);
  const hermesKeys = new Set(hermesEntries.map((entry) => entry.key));

  const entries: AdapterSkillEntry[] = [];
  const warnings: string[] = [];

  for (const entry of paperclipEntries) {
    const desired = desiredSet.has(entry.key);
    entries.push({
      key: entry.key,
      runtimeName: entry.runtimeName,
      desired,
      managed: true,
      state: desired ? "configured" : "available",
      origin: entry.required ? "paperclip_required" : "company_managed",
      originLabel: entry.required ? "Required by Paperclip" : "Managed by Paperclip",
      readOnly: false,
      sourcePath: entry.source,
      targetPath: null,
      detail: desired ? "Will be available on the next run via Hermes skill loading." : null,
      required: Boolean(entry.required),
      requiredReason: entry.requiredReason ?? null,
    });
  }

  for (const entry of hermesEntries) {
    if (availableByKey.has(entry.key)) continue;
    entries.push(entry);
  }

  for (const desiredSkill of desiredSkills) {
    if (availableByKey.has(desiredSkill) || hermesKeys.has(desiredSkill)) continue;
    warnings.push(`Desired skill "${desiredSkill}" is not available in Paperclip or Hermes skills.`);
    entries.push({
      key: desiredSkill,
      runtimeName: null,
      desired: true,
      managed: true,
      state: "missing",
      origin: "external_unknown",
      originLabel: "External or unavailable",
      readOnly: false,
      sourcePath: null,
      targetPath: null,
      detail: "Cannot find this skill in Paperclip or ~/.hermes/skills/.",
    });
  }

  entries.sort((left, right) => left.key.localeCompare(right.key));

  return {
    adapterType: "hermes_local",
    supported: true,
    mode: "persistent",
    desiredSkills,
    entries,
    warnings,
  };
}

export async function listHermesSkills(ctx: AdapterSkillContext): Promise<AdapterSkillSnapshot> {
  return buildHermesSkillSnapshot(ctx.config);
}

export async function syncHermesSkills(
  ctx: AdapterSkillContext,
  _desiredSkills: string[],
): Promise<AdapterSkillSnapshot> {
  return buildHermesSkillSnapshot(ctx.config);
}
