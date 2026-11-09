import { readFile, writeFile } from "node:fs/promises";

// @ts-ignore Node runs TypeScript with explicit extensions.
import {
  extractAll,
  isTranslationEntry,
  localeName,
  readDictionary,
  // @ts-ignore Node requires the extension.
} from "./shared.ts";

const batchPath = process.argv[2];
if (!batchPath) {
  console.error("usage: node i18n/scripts/apply.ts <batch.json>");
  process.exit(1);
}

const locale = localeName();
if (locale === "en" || locale === "off") {
  console.error("Localization is disabled; set HEADPLANE_LOCALE to a locale first.");
  process.exit(1);
}

const batch = JSON.parse(await readFile(batchPath, "utf8")) as unknown;
if (batch === null || typeof batch !== "object" || Array.isArray(batch)) {
  console.error(`${batchPath} must contain a JSON object`);
  process.exit(1);
}

const extraction = await extractAll(locale);
const known = new Set(extraction.candidates.map((candidate) => candidate.key));
const { file, dictionary: current } = await readDictionary(locale);
const dictionary: Record<string, unknown> = { ...current };

const unknown: string[] = [];
for (const [key, value] of Object.entries(batch)) {
  if (!known.has(key) && !(key in dictionary)) {
    unknown.push(key);
    continue;
  }
  if (!isTranslationEntry(value)) {
    console.error(`${JSON.stringify(key)}: expected a string or { text, values? }.`);
    process.exit(1);
  }
  dictionary[key] = value;
}

if (unknown.length > 0) {
  for (const key of unknown) {
    console.error(`unknown key: ${JSON.stringify(key)}`);
  }
  process.exit(1);
}

const sorted = Object.fromEntries(
  Object.entries(dictionary).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
);
await writeFile(file, `${JSON.stringify(sorted, null, 2)}\n`, "utf8");
console.log(
  `${locale}: applied ${Object.keys(batch).length} entries, ${Object.keys(sorted).length} total`,
);
