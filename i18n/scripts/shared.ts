import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

import type { Candidate, Dictionary, TranslationEntry } from "../transform.ts";
// @ts-ignore Node runs TypeScript with explicit extensions.
import { processCode } from "../transform.ts";

export const ROOT = resolve(import.meta.dirname, "../..");
export const DEFAULT_LOCALE = "zh-CN";

export interface ParseError {
  file: string;
  message: string;
}

export interface Extraction {
  candidates: Candidate[];
  files: number;
  parseErrors: ParseError[];
}

export function localeName(): string {
  const requested = (process.env.HEADPLANE_LOCALE ?? "").trim();
  return requested === "en" || requested === "off" ? requested : requested || DEFAULT_LOCALE;
}

export async function readJson(file: string): Promise<unknown> {
  const raw = await readFile(file, "utf8");
  return JSON.parse(raw) as unknown;
}

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") {
        continue;
      }
      files.push(...(await walk(full)));
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) {
      continue;
    }
    if (entry.name.endsWith(".d.ts")) {
      continue;
    }
    files.push(full);
  }

  return files;
}

export async function appFiles(): Promise<string[]> {
  const appRoot = join(ROOT, "app");
  const files = await walk(appRoot);
  return files
    .map((file) => relative(ROOT, file).replaceAll("\\", "/"))
    .filter((file) => file !== "app/utils/cn-tables.ts")
    .sort();
}

export async function extractAll(locale = DEFAULT_LOCALE): Promise<Extraction> {
  const files = await appFiles();
  const candidates: Candidate[] = [];
  const parseErrors: ParseError[] = [];

  for (const file of files) {
    const code = await readFile(join(ROOT, file), "utf8");
    const result = processCode(code, { file, locale, collectOnly: true });
    candidates.push(...result.candidates);
    if (result.parseError) {
      parseErrors.push({ file, message: result.parseError });
    }
  }

  return { candidates, files: files.length, parseErrors };
}

export interface DictionaryFile {
  file: string;
  raw: unknown;
  dictionary: Record<string, unknown>;
}

export async function readDictionary(locale: string): Promise<DictionaryFile> {
  const file = join(ROOT, "i18n", "locales", `${locale}.json`);
  const raw = await readJson(file);
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${file} must contain a JSON object`);
  }
  return { file, raw, dictionary: raw as Record<string, unknown> };
}

export function isTranslationEntry(value: unknown): value is TranslationEntry {
  if (typeof value === "string") {
    return true;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const object = value as { text?: unknown; values?: unknown };
  if (typeof object.text !== "string") {
    return false;
  }
  if (object.values === undefined) {
    return true;
  }
  if (object.values === null || typeof object.values !== "object" || Array.isArray(object.values)) {
    return false;
  }
  return Object.values(object.values as Record<string, unknown>).every(
    (item) => typeof item === "string",
  );
}

export function translationText(entry: TranslationEntry): string {
  return typeof entry === "string" ? entry : entry.text;
}

export async function readAllowlist(): Promise<Set<string>> {
  try {
    const raw = await readJson(join(ROOT, "i18n", "allowlist.json"));
    if (!Array.isArray(raw) || !raw.every((item) => typeof item === "string")) {
      throw new Error("i18n/allowlist.json must be an array of strings");
    }
    return new Set(raw);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return new Set();
    }
    throw error;
  }
}

export function placeholders(value: string): Set<string> {
  return new Set([...value.matchAll(/\{(\d+)\}/g)].map((match) => match[1]));
}

export function groupByFile<T extends { file: string }>(items: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const group = groups.get(item.file);
    if (group) {
      group.push(item);
    } else {
      groups.set(item.file, [item]);
    }
  }
  return new Map([...groups.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

export type { Dictionary };
