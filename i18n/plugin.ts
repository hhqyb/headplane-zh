import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

import type { Plugin } from "vite";

import type { Dictionary, TranslationEntry } from "./transform";
import { loadParser, processCode } from "./transform";

const VIRTUAL_ID = "virtual:headplane-i18n";
const RESOLVED_ID = `\0${VIRTUAL_ID}`;

interface LocaleState {
  locale: string;
  dictionary: Dictionary;
  file: string;
}

function isEntry(value: unknown): value is TranslationEntry {
  if (typeof value === "string") {
    return true;
  }
  return (
    value !== null &&
    typeof value === "object" &&
    "text" in value &&
    typeof (value as { text?: unknown }).text === "string"
  );
}

function readDictionary(file: string): Dictionary | undefined {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("the locale file must contain a JSON object");
    }

    const dictionary: Dictionary = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (isEntry(value)) {
        dictionary[key] = value;
      }
    }
    return dictionary;
  } catch (error) {
    console.warn(
      `[headplane-i18n] Could not read ${file}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
}

function loadLocale(root: string): LocaleState | undefined {
  const requested = (process.env.HEADPLANE_LOCALE ?? "").trim();
  if (requested === "en" || requested === "off" || requested === "false") {
    return undefined;
  }

  const locale = requested || "zh-CN";
  if (!/^[A-Za-z0-9_-]+$/.test(locale)) {
    console.warn(`[headplane-i18n] Invalid HEADPLANE_LOCALE value: ${locale}`);
    return undefined;
  }

  const file = resolve(root, "i18n", "locales", `${locale}.json`);
  if (!existsSync(file)) {
    if (requested) {
      console.warn(`[headplane-i18n] Locale file not found: ${file}`);
    }
    return undefined;
  }

  const dictionary = readDictionary(file);
  if (!dictionary) {
    return undefined;
  }

  try {
    loadParser();
  } catch (error) {
    console.warn(
      `[headplane-i18n] ${error instanceof Error ? error.message : String(error)} Falling back to English.`,
    );
    return undefined;
  }

  console.log(`[headplane-i18n] ${locale}: ${Object.keys(dictionary).length} translations`);
  return { locale, dictionary, file };
}

function relativeFile(root: string, id: string): string | undefined {
  const clean = id.split("?")[0].replaceAll("\\", "/");
  if (!clean.endsWith(".ts") && !clean.endsWith(".tsx")) {
    return undefined;
  }
  if (clean.endsWith(".d.ts")) {
    return undefined;
  }

  const rel = relative(root, clean).replaceAll("\\", "/");
  if (!rel.startsWith("app/") || rel.startsWith("../") || isAbsolute(rel)) {
    return undefined;
  }
  if (rel === "app/utils/cn-tables.ts") {
    return undefined;
  }
  return rel;
}

function runtimeModules(state: LocaleState | undefined): string {
  const dictionary = state?.dictionary ?? {};
  const messages: Dictionary = {};
  for (const [key, value] of Object.entries(dictionary)) {
    if (/\{\d+\}/.test(key) || typeof value === "object") {
      messages[key] = value;
    }
  }

  return `
export const locale = ${JSON.stringify(state?.locale ?? "en")};
const messages = ${JSON.stringify(messages)};
function format(message, args) {
  return message.replace(/\\{(\\d+)\\}/g, (match, index) => {
    const value = args[Number(index)];
    return value === undefined ? match : String(value);
  });
}
export function __t(message, ...args) {
  const entry = messages[message];
  const text = typeof entry === "string" ? entry : entry && typeof entry.text === "string" ? entry.text : undefined;
  if (text === undefined) {
    return format(message, args);
  }
  const values = entry && typeof entry === "object" ? entry.values : undefined;
  return text.replace(/\\{(\\d+)\\}/g, (match, index) => {
    const value = args[Number(index)];
    if (value === undefined) return match;
    if (values && typeof value === "string" && Object.prototype.hasOwnProperty.call(values, value)) {
      return values[value];
    }
    return String(value);
  });
}
`;
}

export function headplaneI18n(): Plugin {
  let root = process.cwd();
  let state: LocaleState | undefined;

  return {
    name: "headplane-i18n",
    enforce: "pre",

    configResolved(config) {
      if (process.env.VITEST === "true") {
        state = undefined;
        return;
      }
      root = config.root;
      state = loadLocale(root);
    },

    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : null;
    },

    load(id) {
      if (id !== RESOLVED_ID) {
        return null;
      }
      return runtimeModules(state);
    },

    transform(code, id) {
      if (!state) {
        return null;
      }

      const file = relativeFile(root, id);
      if (!file) {
        return null;
      }

      const result = processCode(code, {
        file,
        locale: state.locale,
        dictionary: state.dictionary,
      });

      if (result.parseError) {
        this.warn(`[headplane-i18n] Could not parse ${file}: ${result.parseError}`);
        return null;
      }
      if (!result.changed) {
        return null;
      }

      return { code: result.code, map: null };
    },

    configureServer(server) {
      if (!state) {
        return;
      }
      const localeFile = state.file;
      server.watcher.add(localeFile);
      server.watcher.on("change", (changed) => {
        if (resolve(changed) === resolve(localeFile)) {
          server.restart();
        }
      });
    },
  };
}
