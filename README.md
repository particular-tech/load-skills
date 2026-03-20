# load-skills

`load-skills` loads skill content from configurable locations and validates skill spec constraints.

## Install

```bash
bun add load-skills
```

## Usage

```ts
import { loadSkills } from "load-skills";

const { skills, report } = await loadSkills({
  paths: ["./.agents/skills"],
  recursive: false,
});
```

`config` is optional. Calling `loadSkills()` uses:

- `paths: ["./.agents/skills"]`
- `recursive: false`

`skills` includes loaded skill payloads:

- `meta`: parsed frontmatter object
- `content`: `SKILL.md` content without frontmatter
- `references`: absolute file paths from `references/`
- `scripts`: script descriptors from `scripts/` as `{ path, type }`
- `state`: `"valid"` or `"invalid"`
- `warnings`: warning objects with machine-readable `code`

`report` includes one entry per configured path:

- `paths`: one entry per configured path:
  - `inputPath`: raw path from config
  - `resolvedPath`: absolute resolved path
  - `count`: number of included skills from that path
  - `skillNames`: included skill names from that path
  - `error` (optional): `path_not_found` or `path_not_directory`
- `ignoredDuplicates`: map of skipped duplicate skills (first-find-wins), keyed by kept skill name

## Path Priority

`paths` is also a priority list. If the same `meta.name` appears in multiple paths, the first one found is included and later ones are ignored.

## Warning codes

- `missing_frontmatter`: `SKILL.md` is missing a valid `--- ... ---` frontmatter block.
- `invalid_yaml_frontmatter`: Frontmatter exists but YAML parsing failed or did not produce an object.
- `missing_required_meta_name`: Frontmatter is missing required `name`.
- `missing_required_meta_description`: Frontmatter is missing required `description`.
- `invalid_meta_name`: `name` is present but not a non-empty string.
- `invalid_meta_description`: `description` is present but not a non-empty string.
- `skill_md_content_size_limit_exceeded`: `SKILL.md` body exceeds 500 lines.
- `reference_large_without_toc`: A `references/` file exceeds 300 lines without a table-of-contents marker.
- `resource_read_error`: A resource file or directory could not be read during scanning.
