import path from "node:path";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { loadSkills } from "../src/index.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.map(async (dir) => {
      await rm(dir, { recursive: true, force: true });
    }),
  );
  tempDirs.length = 0;
});

describe("loadSkills", () => {
  it("loads valid skills with metadata, content, references, and scripts", async () => {
    const root = await createTempSkillsRoot();
    await writeSkill(root, "alpha", {
      frontmatter: { name: "alpha", description: "alpha skill" },
      body: "## Instructions\nRun alpha.",
      references: {
        "reference.md": "# Table of Contents\n- Intro\n\n## Intro\ntext",
      },
      scripts: {
        "run.ts": "console.log('hello')",
        "bin/noext": "#!/usr/bin/env python\nprint('hi')",
      },
    });

    const { skills, report } = await loadSkills({
      paths: [root],
      recursive: false,
    });
    expect(Object.keys(skills)).toHaveLength(1);
    expect(report.paths).toHaveLength(1);
    expect(report.paths[0]?.error).toBeUndefined();
    expect(report.paths[0]?.count).toBe(1);
    expect(report.paths[0]?.skillNames).toEqual(["alpha"]);
    expect(report.ignoredDuplicates).toEqual({});
    expect(report.invalidSkills).toEqual([]);

    const skill = skills.alpha!;
    expect(skill.meta.name).toBe("alpha");
    expect(skill.meta.description).toBe("alpha skill");
    expect(skill.content).toContain("## Instructions");
    expect(skill.references.length).toBe(1);
    expect(
      skill.references[0]?.endsWith(
        path.join("alpha", "references", "reference.md"),
      ),
    ).toBe(true);
    expect(
      skill.scripts.some(
        (script) =>
          script.type === "python" &&
          script.path.endsWith(path.join("scripts", "bin", "noext")),
      ),
    ).toBe(true);
    expect(
      skill.scripts.some(
        (script) =>
          script.type === "typescript" &&
          script.path.endsWith(path.join("scripts", "run.ts")),
      ),
    ).toBe(true);
    expect(skill.meta.name).toBe("alpha");
    expect(typeof skill.meta.description).toBe("string");
  });

  it("uses default path and recursive=false when called without config", async () => {
    const root = await createTempSkillsRoot();
    const previousCwd = process.cwd();
    await mkdir(path.join(root, ".agents", "skills"), { recursive: true });
    await writeSkill(path.join(root, ".agents", "skills"), "default-skill", {
      frontmatter: { name: "default-skill", description: "from default path" },
      body: "content",
    });
    await writeSkill(
      path.join(root, ".agents", "skills", "nested"),
      "ignored",
      {
        frontmatter: { name: "ignored", description: "nested" },
        body: "nested",
      },
    );

    try {
      process.chdir(root);
      const result = await loadSkills();
      expect(Object.keys(result.skills)).toHaveLength(1);
      expect(result.skills["default-skill"]?.meta.name).toBe("default-skill");
      expect(result.report.invalidSkills).toHaveLength(0);
      expect(result.report.paths).toHaveLength(1);
      expect(result.report.paths[0]?.inputPath).toBe("./.agents/skills");
      expect(result.report.paths[0]?.count).toBe(1);
    } finally {
      process.chdir(previousCwd);
    }
  });

  it("respects recursive false and true behavior", async () => {
    const root = await createTempSkillsRoot();
    await writeSkill(root, "top", {
      frontmatter: { name: "top", description: "top skill" },
      body: "top",
    });
    await writeSkill(path.join(root, "nested-group"), "nested", {
      frontmatter: { name: "nested", description: "nested skill" },
      body: "nested",
    });

    const nonRecursive = await loadSkills({ paths: [root], recursive: false });
    expect(Object.keys(nonRecursive.skills)).toEqual(["top"]);

    const recursive = await loadSkills({ paths: [root], recursive: true });
    expect(Object.keys(recursive.skills).sort()).toEqual(["nested", "top"]);
  });

  it("returns invalid when frontmatter is missing", async () => {
    const root = await createTempSkillsRoot();
    await writeSkill(root, "missing-frontmatter", {
      rawSkill: "## Instructions\nNo frontmatter.",
    });

    const result = await loadSkills({ paths: [root] });
    expect(Object.keys(result.skills)).toHaveLength(0);
    const invalid = result.report.invalidSkills[0]!;
    expect(
      invalid.warnings.some(
        (warning) => warning.code === "missing_frontmatter",
      ),
    ).toBe(true);
  });

  it("returns invalid when frontmatter yaml is malformed", async () => {
    const root = await createTempSkillsRoot();
    await writeSkill(root, "bad-yaml", {
      rawSkill: "---\nname: bad-yaml\ndescription: [broken\n---\nbody",
    });

    const result = await loadSkills({ paths: [root] });
    expect(Object.keys(result.skills)).toHaveLength(0);
    const invalid = result.report.invalidSkills[0]!;
    expect(
      invalid.warnings.some(
        (warning) => warning.code === "invalid_yaml_frontmatter",
      ),
    ).toBe(true);
  });

  it("returns invalid when required meta fields are missing", async () => {
    const root = await createTempSkillsRoot();
    await writeSkill(root, "missing-meta", {
      frontmatter: { name: "missing-meta" },
      body: "content",
    });

    const result = await loadSkills({ paths: [root] });
    expect(Object.keys(result.skills)).toHaveLength(0);
    const invalid = result.report.invalidSkills[0]!;
    expect(
      invalid.warnings.some(
        (warning) => warning.code === "missing_required_meta_description",
      ),
    ).toBe(true);
  });

  it("returns invalid when required meta fields are non-string", async () => {
    const root = await createTempSkillsRoot();
    await writeSkill(root, "bad-meta-type", {
      rawSkill: "---\nname: 123\ndescription: true\n---\ncontent",
    });

    const result = await loadSkills({ paths: [root] });
    expect(Object.keys(result.skills)).toHaveLength(0);
    const invalid = result.report.invalidSkills[0]!;
    expect(
      invalid.warnings.some((warning) => warning.code === "invalid_meta_name"),
    ).toBe(true);
    expect(
      invalid.warnings.some(
        (warning) => warning.code === "invalid_meta_description",
      ),
    ).toBe(true);
  });

  it("treats empty frontmatter as missing required fields, not invalid yaml", async () => {
    const root = await createTempSkillsRoot();
    await writeSkill(root, "empty-frontmatter", {
      rawSkill: "---\n---\ncontent",
    });

    const result = await loadSkills({ paths: [root] });
    expect(Object.keys(result.skills)).toHaveLength(0);
    const invalid = result.report.invalidSkills[0]!;
    expect(
      invalid.warnings.some(
        (warning) => warning.code === "invalid_yaml_frontmatter",
      ),
    ).toBe(false);
    expect(
      invalid.warnings.some(
        (warning) => warning.code === "missing_required_meta_name",
      ),
    ).toBe(true);
    expect(
      invalid.warnings.some(
        (warning) => warning.code === "missing_required_meta_description",
      ),
    ).toBe(true);
  });

  it("parses BOM and CRLF frontmatter documents", async () => {
    const root = await createTempSkillsRoot();
    await writeSkill(root, "bom-crlf", {
      rawSkill:
        '\uFEFF---\r\nname: "bom-crlf"\r\ndescription: "skill"\r\n---\r\n## Instructions\r\nUse it.',
    });

    const { skills } = await loadSkills({ paths: [root] });
    const skill = skills["bom-crlf"]!;
    expect(skill.meta.name).toBe("bom-crlf");
    expect(skill.content).toContain("## Instructions");
  });

  it("returns invalid when content exceeds 500 lines", async () => {
    const root = await createTempSkillsRoot();
    const longBody = Array.from(
      { length: 501 },
      (_, i) => `line ${i + 1}`,
    ).join("\n");
    await writeSkill(root, "long", {
      frontmatter: { name: "long", description: "long skill" },
      body: longBody,
    });

    const result = await loadSkills({ paths: [root] });
    expect(Object.keys(result.skills)).toHaveLength(0);
    const invalid = result.report.invalidSkills[0]!;
    expect(
      invalid.warnings.some(
        (warning) => warning.code === "skill_md_content_size_limit_exceeded",
      ),
    ).toBe(true);
  });

  it("keeps large reference files valid when other rules pass", async () => {
    const root = await createTempSkillsRoot();
    const largeRef = Array.from({ length: 301 }, (_, i) => `row ${i + 1}`).join(
      "\n",
    );
    await writeSkill(root, "large-ref", {
      frontmatter: { name: "large-ref", description: "desc" },
      body: "content",
      references: {
        "big.md": largeRef,
      },
    });

    const result = await loadSkills({ paths: [root] });
    expect(Object.keys(result.skills)).toEqual(["large-ref"]);
    expect(result.report.invalidSkills).toEqual([]);
  });

  it("uses first-find-wins for duplicate skill names across paths", async () => {
    const higherPriorityRoot = await createTempSkillsRoot();
    const lowerPriorityRoot = await createTempSkillsRoot();
    await writeSkill(higherPriorityRoot, "a", {
      frontmatter: { name: "dup", description: "first" },
      body: "one",
    });
    await writeSkill(lowerPriorityRoot, "b", {
      frontmatter: { name: "dup", description: "second" },
      body: "two",
    });

    const { skills, report } = await loadSkills({
      paths: [higherPriorityRoot, lowerPriorityRoot],
    });

    expect(Object.keys(skills)).toEqual(["dup"]);
    expect(skills.dup?.meta.name).toBe("dup");
    expect(skills.dup?.content).toContain("one");

    expect(report.paths).toHaveLength(2);
    expect(report.paths[0]?.skillNames).toEqual(["dup"]);
    expect(report.paths[1]?.skillNames).toEqual([]);
    expect(report.invalidSkills).toEqual([]);

    expect(Object.keys(report.ignoredDuplicates)).toEqual(["dup"]);
    const ignored = report.ignoredDuplicates.dup?.[0];
    expect(ignored?.skillName).toBe("dup");
    expect(ignored?.ignoredSkillPath).toContain(
      path.join(lowerPriorityRoot, "b"),
    );
    expect(ignored?.keptSkillPath).toContain(
      path.join(higherPriorityRoot, "a"),
    );
  });

  it("reports missing and non-directory paths and skips them", async () => {
    const root = await createTempSkillsRoot();
    const filePath = path.join(root, "not-dir.txt");
    await writeFile(filePath, "x", "utf8");

    const missingPath = path.join(root, "does-not-exist");
    const result = await loadSkills({ paths: [missingPath, filePath] });

    expect(Object.keys(result.skills)).toHaveLength(0);
    expect(result.report.paths).toHaveLength(2);
    expect(result.report.paths[0]?.error).toBe("path_not_found");
    expect(result.report.paths[1]?.error).toBe("path_not_directory");
    expect(result.report.invalidSkills).toEqual([]);
  });

  it("loads from multiple configured paths in deterministic order", async () => {
    const rootA = await createTempSkillsRoot();
    const rootB = await createTempSkillsRoot();
    await writeSkill(rootA, "alpha", {
      frontmatter: { name: "alpha", description: "first" },
      body: "a",
    });
    await writeSkill(rootB, "beta", {
      frontmatter: { name: "beta", description: "second" },
      body: "b",
    });

    const { skills, report } = await loadSkills({
      paths: [rootB, rootA],
      recursive: false,
    });
    expect(new Set(Object.keys(skills))).toEqual(new Set(["alpha", "beta"]));
    expect(report.paths).toHaveLength(2);
    expect(report.paths[0]?.error).toBeUndefined();
    expect(report.paths[1]?.error).toBeUndefined();
    expect(report.invalidSkills).toEqual([]);
  });

  it("inspects symlinked skill directories like regular directories", async () => {
    const root = await createTempSkillsRoot();
    await writeSkill(root, "alpha", {
      frontmatter: { name: "alpha", description: "alpha" },
      body: "content",
    });

    const linkedRoot = path.join(root, "linked-skills");
    await mkdir(linkedRoot, { recursive: true });
    await symlink(path.join(root, "alpha"), path.join(linkedRoot, "alpha"));

    const result = await loadSkills({ paths: [linkedRoot], recursive: false });
    expect(Object.keys(result.skills)).toEqual(["alpha"]);
    expect(result.report.paths[0]?.count).toBe(1);
  });

  it("returns empty skills when all configured paths are invalid", async () => {
    const root = await createTempSkillsRoot();
    const filePath = path.join(root, "file.txt");
    await writeFile(filePath, "nope", "utf8");

    const result = await loadSkills({
      paths: [path.join(root, "missing"), filePath],
    });
    expect(Object.keys(result.skills)).toHaveLength(0);
    expect(result.report.paths.map((item) => item.error)).toEqual([
      "path_not_found",
      "path_not_directory",
    ]);
    expect(result.report.invalidSkills).toEqual([]);
  });
});

interface SkillFixtureOptions {
  frontmatter?: Record<string, string>;
  body?: string;
  rawSkill?: string;
  references?: Record<string, string>;
  scripts?: Record<string, string>;
}

async function createTempSkillsRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "load-skills-test-"));
  tempDirs.push(root);
  return root;
}

async function writeSkill(
  skillsRoot: string,
  skillDirectoryName: string,
  options: SkillFixtureOptions,
): Promise<void> {
  const skillDir = path.join(skillsRoot, skillDirectoryName);
  await mkdir(skillDir, { recursive: true });

  const skillText = buildSkillDocument(options);
  await writeFile(path.join(skillDir, "SKILL.md"), skillText, "utf8");

  if (options.references) {
    for (const [relativePath, content] of Object.entries(options.references)) {
      const target = path.join(skillDir, "references", relativePath);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
    }
  }

  if (options.scripts) {
    for (const [relativePath, content] of Object.entries(options.scripts)) {
      const target = path.join(skillDir, "scripts", relativePath);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
    }
  }
}

function buildSkillDocument(options: SkillFixtureOptions): string {
  if (options.rawSkill) {
    return options.rawSkill;
  }

  const frontmatter = options.frontmatter ?? {};
  const frontmatterText = Object.entries(frontmatter)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join("\n");

  return `---\n${frontmatterText}\n---\n${options.body ?? ""}`;
}
