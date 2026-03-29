import type { SkillMeta, SkillWarning } from "./types.js";

const INVALID_WARNING_CODES = new Set([
  "missing_frontmatter",
  "invalid_yaml_frontmatter",
  "missing_required_meta_name",
  "missing_required_meta_description",
  "invalid_meta_name",
  "invalid_meta_description",
  "skill_md_content_size_limit_exceeded",
  "resource_read_error",
]);

export function applyValidationRules(input: {
  meta: Record<string, unknown>;
  content: string;
  warnings: SkillWarning[];
}): {
  warnings: SkillWarning[];
  isValid: boolean;
  meta?: SkillMeta;
} {
  const warnings = [...input.warnings];
  const metaName = input.meta.name;
  const metaDescription = input.meta.description;

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

  const contentLineCount = getLineCount(input.content);
  if (contentLineCount > 500) {
    warnings.push({
      code: "skill_md_content_size_limit_exceeded",
      message: `SKILL.md body exceeds the recommended 500-line limit (${contentLineCount} lines).`,
    });
  }

  const dedupedWarnings = dedupeWarnings(warnings);
  const isValid = !dedupedWarnings.some((warning) =>
    INVALID_WARNING_CODES.has(warning.code),
  );

  if (isValid) {
    return {
      warnings: dedupedWarnings,
      isValid: true,
      meta: input.meta as SkillMeta,
    };
  }

  return {
    warnings: dedupedWarnings,
    isValid: false,
  };
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
