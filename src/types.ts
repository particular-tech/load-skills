export type SkillState = "valid" | "invalid";

export type SkillScriptType =
  | "javascript"
  | "typescript"
  | "python"
  | "shell"
  | "ruby"
  | "other";

export type SkillWarningCode =
  | "missing_frontmatter"
  | "invalid_yaml_frontmatter"
  | "missing_required_meta_name"
  | "missing_required_meta_description"
  | "invalid_meta_name"
  | "invalid_meta_description"
  | "skill_md_content_size_limit_exceeded"
  | "reference_large_without_toc"
  | "resource_read_error";

export interface SkillWarning {
  code: SkillWarningCode;
  message: string;
}

export interface SkillScript {
  path: string;
  type: SkillScriptType;
}

export interface LoadedSkill {
  meta: Record<string, unknown>;
  content: string;
  references: string[];
  scripts: SkillScript[];
  state: SkillState;
  warnings: SkillWarning[];
  skillPath: string;
  skillFilePath: string;
}

export interface LoadSkillsConfig {
  paths?: string[];
  recursive?: boolean;
  cwd?: string;
}

export type LoadSkillsPathError = "path_not_found" | "path_not_directory";

export interface LoadSkillsPathReport {
  inputPath: string;
  resolvedPath: string;
  count: number;
  skillNames: string[];
  error?: LoadSkillsPathError;
}

export interface IgnoredDuplicateSkill {
  skillName: string;
  normalizedSkillName: string;
  ignoredSkillPath: string;
  ignoredSkillFilePath: string;
  ignoredFromInputPath: string;
  keptSkillPath: string;
  keptSkillFilePath: string;
  keptFromInputPath: string;
}

export interface LoadSkillsReport {
  paths: LoadSkillsPathReport[];
  ignoredDuplicates: Record<string, IgnoredDuplicateSkill[]>;
}

export interface LoadSkillsResult {
  skills: LoadedSkill[];
  report: LoadSkillsReport;
}

export interface ParseSkillResult {
  meta: Record<string, unknown>;
  content: string;
  warnings: SkillWarning[];
}
