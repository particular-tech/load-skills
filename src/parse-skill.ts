import { parse as parseYaml } from "yaml";

import type { ParseSkillResult, SkillWarning } from "./types.js";
import { getErrorMessage } from "./utils.js";

export function parseSkillDocument(rawText: string): ParseSkillResult {
  const warnings: SkillWarning[] = [];
  const text = rawText.replace(/^\uFEFF/, "");

  if (!text.startsWith("---\n") && !text.startsWith("---\r\n")) {
    warnings.push({
      code: "missing_frontmatter",
      message: "SKILL.md is missing YAML frontmatter delimiters.",
    });

    return {
      meta: {},
      content: text,
      warnings,
    };
  }

  const lines = text.split(/\r?\n/);
  let closingIndex = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i] === "---") {
      closingIndex = i;
      break;
    }
  }

  if (closingIndex === -1) {
    warnings.push({
      code: "missing_frontmatter",
      message:
        "Frontmatter opening delimiter exists but closing delimiter is missing.",
    });

    return {
      meta: {},
      content: text,
      warnings,
    };
  }

  const frontmatterRaw = lines.slice(1, closingIndex).join("\n");
  const body = lines.slice(closingIndex + 1).join("\n");

  if (frontmatterRaw.trim() === "") {
    return {
      meta: {},
      content: body,
      warnings,
    };
  }

  try {
    const parsed = parseYaml(frontmatterRaw);

    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      warnings.push({
        code: "invalid_yaml_frontmatter",
        message: "Frontmatter must parse to a YAML object.",
      });

      return {
        meta: {},
        content: body,
        warnings,
      };
    }

    return {
      meta: parsed as Record<string, unknown>,
      content: body,
      warnings,
    };
  } catch (error) {
    warnings.push({
      code: "invalid_yaml_frontmatter",
      message: `Unable to parse YAML frontmatter: ${getErrorMessage(error)}`,
    });

    return {
      meta: {},
      content: body,
      warnings,
    };
  }
}
