import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// @ts-ignore Node runs TypeScript with explicit extensions.
import type { Candidate } from "../transform.ts";
// @ts-ignore Node runs TypeScript with explicit extensions.
import {
  ROOT,
  extractAll,
  groupByFile,
  localeName,
  readAllowlist,
  readDictionary,
  // @ts-ignore Node requires the extension.
} from "./shared.ts";

const strict = process.argv.includes("--strict");
const locale = localeName();

if (locale === "en" || locale === "off") {
  console.log("Localization is disabled; nothing to extract.");
  process.exit(0);
}

const extraction = await extractAll(locale);
if (extraction.parseErrors.length > 0) {
  for (const error of extraction.parseErrors) {
    console.error(`${error.file}: ${error.message}`);
  }
  process.exit(1);
}

const { dictionary } = await readDictionary(locale);
const dictionaryKeys = new Set(Object.keys(dictionary));
const allowlist = await readAllowlist();
const candidateKeys = new Set(extraction.candidates.map((candidate) => candidate.key));

const missing = extraction.candidates.filter(
  (candidate) =>
    !candidate.optional && !dictionaryKeys.has(candidate.key) && !allowlist.has(candidate.key),
);
const optional = extraction.candidates.filter(
  (candidate) => candidate.optional && !dictionaryKeys.has(candidate.key),
);
const unused = [...dictionaryKeys].filter((key) => !candidateKeys.has(key)).sort();

const missingKeys = new Set(missing.map((candidate) => candidate.key));
const optionalKeys = new Set(optional.map((candidate) => candidate.key));

function uniqueByKey(candidates: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.key)) {
      return false;
    }
    seen.add(candidate.key);
    return true;
  });
}

function group(candidates: Candidate[]): Map<string, Candidate[]> {
  return groupByFile(candidates);
}

const report = {
  locale,
  generatedAt: new Date().toISOString(),
  files: extraction.files,
  candidates: extraction.candidates.length,
  candidateKeys: candidateKeys.size,
  translatedKeys: dictionaryKeys.size,
  missingKeys: missingKeys.size,
  optionalPatternKeys: optionalKeys.size,
  unusedKeys: unused.length,
  missing,
  optionalPatterns: uniqueByKey(optional),
  unused,
};

const reports = join(ROOT, "i18n", "reports");
await mkdir(reports, { recursive: true });
await writeFile(join(reports, "untranslated.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");

const lines: string[] = [
  `# Untranslated strings (${locale})`,
  "",
  `Generated at ${report.generatedAt}.`,
  "",
  `- Files scanned: ${report.files}`,
  `- Candidate occurrences: ${report.candidates}`,
  `- Missing keys: ${report.missingKeys}`,
  `- Optional pattern keys: ${report.optionalPatternKeys}`,
  `- Dictionary keys: ${report.translatedKeys}`,
  "",
];

if (missingKeys.size > 0) {
  lines.push("## Missing", "");
  for (const [file, entries] of group(missing)) {
    lines.push(`### ${file}`, "");
    for (const entry of entries) {
      lines.push(
        `- [ ] ${JSON.stringify(entry.key)} — ${entry.kind}, line ${entry.line}`,
        `  - Context: \`${entry.context.replaceAll("`", "'")}\``,
      );
    }
    lines.push("");
  }
} else {
  lines.push("All required strings are translated.", "");
}

if (optionalKeys.size > 0) {
  lines.push("## Optional JSX patterns", "");
  for (const entry of uniqueByKey(optional)) {
    lines.push(
      `- ${JSON.stringify(entry.key)} — ${entry.file}:${entry.line}`,
      `  - Context: \`${entry.context.replaceAll("`", "'")}\``,
    );
  }
  lines.push("");
}

if (unused.length > 0) {
  lines.push("## Unused dictionary keys", "");
  for (const key of unused) {
    lines.push(`- ${JSON.stringify(key)}`);
  }
  lines.push("");
}

await writeFile(join(reports, "untranslated.md"), `${lines.join("\n")}\n`, "utf8");

console.log(
  `${locale}: ${missingKeys.size} missing, ${optionalKeys.size} optional, ${unused.length} unused, ${dictionaryKeys.size} translated keys`,
);
console.log(`Report: ${join(reports, "untranslated.md")}`);

if (strict && missingKeys.size > 0) {
  process.exit(1);
}
