import { constants } from "node:fs";
import { open, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { discoverSkillFiles } from "./discovery.js";
import { parseSkillDocument } from "./parse-skill.js";
import type {
  IgnoredDuplicateSkill,
  InvalidSkill,
  LoadSkillsConfig,
  LoadSkillsResult,
  Skill,
  SkillScript,
  SkillScriptType,
  SkillWarning,
} from "./types.js";
import { getErrorMessage, pathExists } from "./utils.js";
import { applyValidationRules } from "./validate-skill.js";

export async function loadSkills(
  config?: LoadSkillsConfig,
): Promise<LoadSkillsResult> {
  const resolvedConfig = config ?? {};
  const discovery = await discoverSkillFiles(resolvedConfig);
  const skills: Record<string, Skill> = {};
  const invalidSkills: InvalidSkill[] = [];
  const reportPaths = discovery.report.map((entry) => ({ ...entry }));
  const ignoredDuplicates: Record<string, IgnoredDuplicateSkill[]> = {};
  const includedByName = new Map<
    string,
    {
      skillName: string;
      skillPath: string;
      skillFilePath: string;
      inputPath: string;
    }
  >();

  for (const discovered of discovery.discoveredSkillFiles) {
    const skillFilePath = discovered.skillFilePath;
    const skillPath = path.dirname(skillFilePath);
    const skillWarnings: SkillWarning[] = [];

    const rawSkillText = await readFile(skillFilePath, "utf8");
    const parsed = parseSkillDocument(rawSkillText);
    skillWarnings.push(...parsed.warnings);

    const resourceScan = await collectResources(skillPath);
    skillWarnings.push(...resourceScan.warnings);

    const validated = applyValidationRules({
      meta: parsed.meta,
      content: parsed.content,
      warnings: skillWarnings,
    });

    const reportItem = reportPaths[discovered.pathReportIndex];
    if (!reportItem) {
      continue;
    }

    if (!validated.isValid || !validated.meta) {
      invalidSkills.push({
        meta: parsed.meta,
        content: parsed.content,
        references: resourceScan.references,
        scripts: resourceScan.scripts,
        warnings: validated.warnings,
        skillPath,
        skillFilePath,
      });
      continue;
    }

    const skill: Skill = {
      meta: validated.meta,
      content: parsed.content,
      references: resourceScan.references,
      scripts: resourceScan.scripts,
      skillPath,
      skillFilePath,
    };

    const normalizedName = skill.meta.name.trim().toLowerCase();
    const existing = includedByName.get(normalizedName);
    if (existing) {
      const ignoredEntry: IgnoredDuplicateSkill = {
        skillName: skill.meta.name,
        normalizedSkillName: normalizedName,
        ignoredSkillPath: skill.skillPath,
        ignoredSkillFilePath: skill.skillFilePath,
        ignoredFromInputPath: discovered.inputPath,
        keptSkillPath: existing.skillPath,
        keptSkillFilePath: existing.skillFilePath,
        keptFromInputPath: existing.inputPath,
      };
      const key = existing.skillName;
      ignoredDuplicates[key] = [
        ...(ignoredDuplicates[key] ?? []),
        ignoredEntry,
      ];
      continue;
    }

    includedByName.set(normalizedName, {
      skillName: skill.meta.name,
      skillPath: skill.skillPath,
      skillFilePath: skill.skillFilePath,
      inputPath: discovered.inputPath,
    });

    skills[skill.meta.name] = skill;
    reportItem.skillNames.push(skill.meta.name);
    reportItem.count += 1;
  }

  for (const reportItem of reportPaths) {
    reportItem.skillNames.sort((a, b) => a.localeCompare(b));
  }

  return {
    skills,
    report: {
      paths: reportPaths,
      ignoredDuplicates,
      invalidSkills,
    },
  };
}

interface ResourceScanResult {
  references: string[];
  scripts: SkillScript[];
  warnings: SkillWarning[];
}

async function collectResources(
  skillPath: string,
): Promise<ResourceScanResult> {
  const referencesRoot = path.join(skillPath, "references");
  const scriptsRoot = path.join(skillPath, "scripts");
  const warnings: SkillWarning[] = [];

  const referenceFiles = await listFilesRecursively(referencesRoot, warnings);
  const scriptFiles = await listFilesRecursively(scriptsRoot, warnings);

  for (const filePath of referenceFiles) {
    try {
      await readFile(filePath, "utf8");
    } catch (error) {
      warnings.push({
        code: "resource_read_error",
        message: `Unable to read reference file ${filePath}: ${getErrorMessage(error)}`,
      });
    }
  }

  const scripts: SkillScript[] = [];
  for (const filePath of scriptFiles) {
    scripts.push({
      path: filePath,
      type: await inferScriptType(filePath),
    });
  }

  return {
    references: referenceFiles.sort((a, b) => a.localeCompare(b)),
    scripts: scripts.sort((a, b) => a.path.localeCompare(b.path)),
    warnings,
  };
}

async function listFilesRecursively(
  maybeRoot: string,
  warnings: SkillWarning[],
): Promise<string[]> {
  const exists = await pathExists(maybeRoot);
  if (!exists) {
    return [];
  }

  const rootStats = await stat(maybeRoot);
  if (!rootStats.isDirectory()) {
    warnings.push({
      code: "resource_read_error",
      message: `Expected directory but found non-directory resource root: ${maybeRoot}`,
    });
    return [];
  }

  const files: string[] = [];

  async function walk(current: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      warnings.push({
        code: "resource_read_error",
        message: `Unable to read resource directory ${current}: ${getErrorMessage(error)}`,
      });
      return;
    }

    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const fullPath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }

  await walk(maybeRoot);
  return files;
}

async function inferScriptType(filePath: string): Promise<SkillScriptType> {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") {
    return "javascript";
  }
  if (ext === ".ts" || ext === ".mts" || ext === ".cts") {
    return "typescript";
  }
  if (ext === ".py") {
    return "python";
  }
  if (ext === ".sh" || ext === ".bash" || ext === ".zsh") {
    return "shell";
  }
  if (ext === ".rb") {
    return "ruby";
  }

  try {
    const firstLine = await readFirstLine(filePath);

    if (firstLine.startsWith("#!")) {
      if (firstLine.includes("python")) {
        return "python";
      }
      if (
        firstLine.includes("bash") ||
        firstLine.includes("sh") ||
        firstLine.includes("zsh")
      ) {
        return "shell";
      }
      if (firstLine.includes("ruby")) {
        return "ruby";
      }
      if (
        firstLine.includes("node") ||
        firstLine.includes("deno") ||
        firstLine.includes("bun")
      ) {
        return "javascript";
      }
    }
  } catch {
    // If we cannot inspect shebang, keep fallback type.
  }

  return "other";
}

async function readFirstLine(filePath: string): Promise<string> {
  const handle = await open(filePath, constants.O_RDONLY);
  try {
    const maxBytes = 1024;
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    const snippet = buffer.subarray(0, bytesRead).toString("utf8");
    return snippet.split(/\r?\n/, 1)[0]?.toLowerCase() ?? "";
  } finally {
    await handle.close();
  }
}
