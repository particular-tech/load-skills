import { constants } from "node:fs";
import { access, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

import type { LoadSkillsConfig, LoadSkillsPathReport } from "./types.js";
import { pathExists } from "./utils.js";

export interface DiscoveredSkillFile {
  skillFilePath: string;
  pathReportIndex: number;
  inputPath: string;
}

export interface DiscoveryResult {
  discoveredSkillFiles: DiscoveredSkillFile[];
  report: LoadSkillsPathReport[];
}

export async function discoverSkillFiles(
  config: LoadSkillsConfig,
): Promise<DiscoveryResult> {
  const cwd = config.cwd ?? process.cwd();
  const recursive = config.recursive ?? false;
  const inputPaths = config.paths ?? ["./.agents/skills"];
  const pathPairs = inputPaths.map((inputPath) => ({
    inputPath,
    resolvedPath: path.resolve(cwd, inputPath),
  }));

  const report: LoadSkillsPathReport[] = [];
  const discoveredSkillFiles: DiscoveredSkillFile[] = [];
  const discovered = new Set<string>();

  for (const pair of pathPairs) {
    const rootPath = pair.resolvedPath;
    const inputPath = pair.inputPath;
    const reportItem: LoadSkillsPathReport = {
      inputPath,
      resolvedPath: rootPath,
      count: 0,
      skillNames: [],
    };

    const rootExists = await pathExists(rootPath);
    if (!rootExists) {
      reportItem.error = "path_not_found";
      report.push(reportItem);
      continue;
    }

    const rootStat = await stat(rootPath);
    if (!rootStat.isDirectory()) {
      reportItem.error = "path_not_directory";
      report.push(reportItem);
      continue;
    }

    const found = recursive
      ? await discoverRecursive(rootPath)
      : await discoverNonRecursive(rootPath);

    const pathReportIndex = report.length;
    for (const skillFilePath of found) {
      const canonical = await realpath(skillFilePath);
      if (!discovered.has(canonical)) {
        discovered.add(canonical);
        discoveredSkillFiles.push({
          skillFilePath: canonical,
          pathReportIndex,
          inputPath,
        });
      }
    }

    report.push(reportItem);
  }

  return {
    discoveredSkillFiles,
    report,
  };
}

async function discoverNonRecursive(rootPath: string): Promise<string[]> {
  const entries = await readdir(rootPath, { withFileTypes: true });
  const paths: string[] = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) {
      continue;
    }

    const candidate = path.join(rootPath, entry.name, "SKILL.md");
    if (await isReadableFile(candidate)) {
      paths.push(candidate);
    }
  }

  return paths;
}

async function discoverRecursive(rootPath: string): Promise<string[]> {
  const paths: string[] = [];

  async function walk(currentPath: string): Promise<void> {
    const entries = await readdir(currentPath, { withFileTypes: true });

    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const fullPath = path.join(currentPath, entry.name);

      if (entry.isFile() && entry.name === "SKILL.md") {
        paths.push(fullPath);
        continue;
      }

      if (entry.isDirectory()) {
        await walk(fullPath);
      }
    }
  }

  await walk(rootPath);
  return paths;
}

async function isReadableFile(targetPath: string): Promise<boolean> {
  try {
    const targetStat = await stat(targetPath);
    if (!targetStat.isFile()) {
      return false;
    }
    await access(targetPath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}
