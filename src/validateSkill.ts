import type { LoadedSkill, SkillWarning } from "./types.js";

const INVALID_WARNING_CODES = new Set([
  "missing_frontmatter",
  "invalid_yaml_frontmatter",
  "missing_required_meta_name",
  "missing_required_meta_description",
  "invalid_meta_name",
  "invalid_meta_description",
  "skill_md_content_size_limit_exceeded",
  "reference_large_without_toc",
  "resource_read_error",
]);

export function applyValidationRules(skill: LoadedSkill): LoadedSkill {
  const warnings = [...skill.warnings];
  const metaName = skill.meta.name;
  const metaDescription = skill.meta.description;

  if (typeof metaName !== "string" || metaName.trim() === "") {
    warnings.push({
      code:
        typeof metaName === "undefined"
          ? "missing_required_meta_name"
          : "invalid_meta_name",
      message:
        "Frontmatter field `name` is required and must be a non-empty string.",
    });
  }

  if (typeof metaDescription !== "string" || metaDescription.trim() === "") {
    warnings.push({
      code:
        typeof metaDescription === "undefined"
          ? "missing_required_meta_description"
          : "invalid_meta_description",
      message:
        "Frontmatter field `description` is required and must be a non-empty string.",
    });
  }

  const contentLineCount = getLineCount(skill.content);
  if (contentLineCount > 500) {
    warnings.push({
      code: "skill_md_content_size_limit_exceeded",
      message: `SKILL.md body exceeds the recommended 500-line limit (${contentLineCount} lines).`,
    });
  }

  const state = warnings.some((warning) =>
    INVALID_WARNING_CODES.has(warning.code),
  )
    ? "invalid"
    : "valid";

  return {
    ...skill,
    warnings: dedupeWarnings(warnings),
    state,
  };
}

export function validateLargeReferences(
  references: Array<{ path: string; content: string; lineCount: number }>,
): SkillWarning[] {
  const warnings: SkillWarning[] = [];

  for (const reference of references) {
    if (reference.lineCount <= 300) {
      continue;
    }

    const normalized = reference.content.toLowerCase();
    const hasTocMarker =
      normalized.includes("table of contents") || normalized.includes("[toc]");

    if (!hasTocMarker) {
      warnings.push({
        code: "reference_large_without_toc",
        message: `Large reference file is missing a table of contents hint: ${reference.path}`,
      });
    }
  }

  return warnings;
}

function dedupeWarnings(warnings: SkillWarning[]): SkillWarning[] {
  const keys = new Set<string>();
  const deduped: SkillWarning[] = [];

  for (const warning of warnings) {
    const key = `${warning.code}:${warning.message}`;
    if (keys.has(key)) {
      continue;
    }

    keys.add(key);
    deduped.push(warning);
  }

  return deduped;
}

function getLineCount(content: string): number {
  if (content.length === 0) {
    return 0;
  }

  return content.split(/\r?\n/).length;
}
