// @ts-ignore Node runs TypeScript with explicit extensions.
import {
  extractAll,
  groupByFile,
  isTranslationEntry,
  localeName,
  placeholders,
  readAllowlist,
  readDictionary,
  translationText,
  // @ts-ignore Node requires the extension.
} from "./shared.ts";

const locale = localeName();

if (locale === "en" || locale === "off") {
  console.log("Localization is disabled; nothing to check.");
  process.exit(0);
}

const extraction = await extractAll(locale);
const { dictionary } = await readDictionary(locale);
const allowlist = await readAllowlist();

const errors: string[] = [];
const warnings: string[] = [];

for (const error of extraction.parseErrors) {
  errors.push(`${error.file}: ${error.message}`);
}

for (const [key, value] of Object.entries(dictionary)) {
  if (key.length === 0) {
    errors.push("Dictionary contains an empty key.");
    continue;
  }
  if (!isTranslationEntry(value)) {
    errors.push(`${JSON.stringify(key)}: expected a string or { text, values? }.`);
    continue;
  }

  const text = translationText(value);
  if (text.length === 0) {
    warnings.push(`${JSON.stringify(key)}: translation is empty.`);
  }

  const keyPlaceholders = placeholders(key);
  const textPlaceholders = placeholders(text);
  for (const placeholder of textPlaceholders) {
    if (!keyPlaceholders.has(placeholder)) {
      errors.push(
        `${JSON.stringify(key)}: translation uses {${placeholder}} but the source key does not.`,
      );
    }
  }
  for (const placeholder of keyPlaceholders) {
    if (!textPlaceholders.has(placeholder)) {
      warnings.push(
        `${JSON.stringify(key)}: translation omits {${placeholder}} (allowed, but double-check).`,
      );
    }
  }
}

const dictionaryKeys = new Set(Object.keys(dictionary));
const candidateKeys = new Set(extraction.candidates.map((candidate) => candidate.key));

const missing = extraction.candidates.filter(
  (candidate) =>
    !candidate.optional && !dictionaryKeys.has(candidate.key) && !allowlist.has(candidate.key),
);
const missingKeys = new Set(missing.map((candidate) => candidate.key));

for (const [file, entries] of groupByFile(missing)) {
  for (const entry of entries) {
    errors.push(`${file}:${entry.line}: missing ${JSON.stringify(entry.key)} (${entry.kind})`);
  }
}

const unused = [...dictionaryKeys].filter((key) => !candidateKeys.has(key)).sort();
for (const key of unused) {
  warnings.push(`${JSON.stringify(key)}: unused by any current source string.`);
}

for (const error of errors) {
  console.error(`error: ${error}`);
}
for (const warning of warnings) {
  console.warn(`warn: ${warning}`);
}

console.log(
  `${locale}: ${missingKeys.size} missing keys, ${unused.length} unused keys, ${errors.length} errors, ${warnings.length} warnings`,
);

if (errors.length > 0) {
  process.exit(1);
}
