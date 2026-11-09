import { createRequire } from "node:module";

export type TranslationEntry = string | { text: string; values?: Record<string, string> };
export type Dictionary = Record<string, TranslationEntry>;

export type CandidateKind =
  | "jsx-text"
  | "jsx-attribute"
  | "jsx-expression"
  | "jsx-pattern"
  | "object-property"
  | "display-call"
  | "valibot"
  | "binder"
  | "file-literal"
  | "template"
  | "concatenation";

export interface Candidate {
  key: string;
  kind: CandidateKind;
  file: string;
  line: number;
  column: number;
  context: string;
  optional: boolean;
}

export interface ProcessOptions {
  file: string;
  locale?: string;
  dictionary?: Dictionary;
  collectOnly?: boolean;
}

export interface ProcessResult {
  code: string;
  changed: boolean;
  candidates: Candidate[];
  usedKeys: string[];
  runtimeKeys: string[];
  parseError?: string;
}

type AnyNode = {
  type: string;
  start: number;
  end: number;
  loc?: { start: { line: number; column: number } } | null;
  [key: string]: any;
};

interface ParseFunction {
  (code: string, options: { sourceType: "module"; plugins: string[] }): { program: AnyNode };
}

const VIRTUAL_ID = "virtual:headplane-i18n";
const RUNTIME_HELPER = "__hpT";

const DISPLAY_ATTRIBUTES = new Set([
  "title",
  "description",
  "label",
  "placeholder",
  "labelTooltip",
  "errorMessage",
  "aria-label",
  "alt",
  "text",
  "emptyText",
  "submitLabel",
  "content",
  "hint",
  "tooltip",
  "fieldDescription",
  "message",
  "page",
]);

const COMPONENT_ATTRIBUTES: Record<string, Set<string>> = {
  Attribute: new Set(["name", "value"]),
};

const DISPLAY_PROPERTIES = new Set([
  "title",
  "description",
  "label",
  "text",
  "content",
  "emptyText",
  "empty",
  "submitLabel",
  "placeholder",
  "message",
  "hint",
  "field",
  "fieldDescription",
  "labelTooltip",
  "errorMessage",
]);

const DISPLAY_BINDERS = new Set([
  "label",
  "title",
  "description",
  "text",
  "emptyText",
  "submitLabel",
  "placeholder",
  "children",
  "content",
  "message",
  "hint",
]);

const LITERAL_FILES = new Set([
  "app/utils/time.ts",
  "app/utils/host-info.ts",
  "app/utils/user.ts",
  "app/utils/describe-error.ts",
  "app/utils/acl-policy.ts",
  "app/server/headscale/api/error-client.ts",
  "app/routes/settings/restrictions/actions.ts",
  "app/routes/users/components/headplane-user-row.tsx",
  "app/routes/users/dialogs/reassign-user.tsx",
]);

const FILE_PROPERTIES: Record<string, Set<string>> = {
  "app/routes/settings/restrictions/actions.ts": new Set(["domain", "group", "user"]),
  "app/routes/users/dialogs/reassign-user.tsx": new Set(["name", "desc"]),
  "app/utils/acl-policy.ts": new Set(["error"]),
  "app/server/headscale/api/error.ts": new Set(["errorMessage"]),
};

const DISPLAY_CALLS = new Set(["ok", "toast", "disabled", "data"]);
const DATE_METHODS = new Set(["toLocaleString", "toLocaleDateString", "toLocaleTimeString"]);

const VALIBOT_MESSAGE_ARGS: Record<string, number[]> = {
  string: [0],
  number: [0],
  boolean: [0],
  bigint: [0],
  date: [0],
  symbol: [0],
  regex: [1],
  nonEmpty: [0],
  minLength: [1],
  maxLength: [1],
  length: [1],
  minValue: [1],
  maxValue: [1],
  startsWith: [1],
  endsWith: [1],
  includes: [1],
  excludes: [1],
  check: [1],
  checkItems: [1],
  rawCheck: [1],
  picklist: [1],
  literal: [1],
  enum: [1],
  instance: [1],
  custom: [1],
};

const TYPE_NODES = new Set([
  "TSTypeAnnotation",
  "TSTypeReference",
  "TSLiteralType",
  "TSUnionType",
  "TSIntersectionType",
  "TSArrayType",
  "TSTupleType",
  "TSTypeQuery",
  "TSTypeOperator",
  "TSIndexedAccessType",
  "TSMappedType",
  "TSConditionalType",
  "TSInferType",
  "TSTypePredicate",
  "TSTypeParameter",
  "TSInterfaceDeclaration",
  "TSTypeAliasDeclaration",
  "TSEnumDeclaration",
  "TSModuleDeclaration",
  "TSPropertySignature",
  "TSMethodSignature",
  "TSIndexSignature",
  "TSCallSignatureDeclaration",
  "TSConstructSignatureDeclaration",
  "TSDeclareFunction",
  "TSImportType",
]);

const SKIP_KEYS = new Set([
  "loc",
  "start",
  "end",
  "extra",
  "leadingComments",
  "trailingComments",
  "innerComments",
  "comments",
  "tokens",
  "errors",
]);

let cachedParser: ParseFunction | undefined;

function parserFrom(module: any): ParseFunction | undefined {
  const parse = module?.parse ?? module?.default?.parse;
  return typeof parse === "function" ? (parse as ParseFunction) : undefined;
}

export function loadParser(): ParseFunction {
  if (cachedParser) {
    return cachedParser;
  }

  const require = createRequire(import.meta.url);

  try {
    const parser = parserFrom(require("@babel/parser"));
    if (parser) {
      cachedParser = parser;
      return parser;
    }
  } catch {}

  const candidates = ["@react-router/dev", "@react-router/dev/package.json"];
  for (const candidate of candidates) {
    try {
      const resolved = require.resolve(candidate);
      const parser = parserFrom(createRequire(resolved)("@babel/parser"));
      if (parser) {
        cachedParser = parser;
        return parser;
      }
    } catch {}
  }

  throw new Error(
    "Could not load @babel/parser. Add @babel/parser as a devDependency or keep @react-router/dev installed.",
  );
}

function parseCode(code: string, file: string): AnyNode {
  const withJsx = file.endsWith(".tsx") || file.endsWith(".jsx");
  const base = ["typescript", ...(withJsx ? ["jsx"] : [])];
  const parse = loadParser();

  try {
    return parse(code, {
      sourceType: "module",
      plugins: [...base, "importAttributes", "explicitResourceManagement"],
    }).program;
  } catch {
    return parse(code, { sourceType: "module", plugins: base }).program;
  }
}

export function normalizeJsxText(value: string): string {
  const lines = value.split(/\r\n|\n|\r/);
  let lastNonEmptyLine = 0;
  for (let index = 0; index < lines.length; index++) {
    if (/[^ \t]/.test(lines[index])) {
      lastNonEmptyLine = index;
    }
  }

  let result = "";
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    let trimmed = line.replace(/\t/g, " ");
    if (index !== 0) {
      trimmed = trimmed.replace(/^ +/, "");
    }
    if (index !== lines.length - 1) {
      trimmed = trimmed.replace(/ +$/, "");
    }
    if (trimmed) {
      if (index !== lastNonEmptyLine) {
        trimmed += " ";
      }
      result += trimmed;
    }
  }

  return result;
}

function normalizeFile(file: string): string {
  return file.replaceAll("\\", "/").replace(/\?.*$/, "");
}

function isLiteralFile(file: string): boolean {
  return LITERAL_FILES.has(file);
}

function jsString(value: string): string {
  return JSON.stringify(value) ?? '""';
}

function translationText(entry: TranslationEntry | undefined): string | undefined {
  if (typeof entry === "string") {
    return entry;
  }
  if (entry && typeof entry === "object" && typeof entry.text === "string") {
    return entry.text;
  }
  return undefined;
}

function nodeName(node: AnyNode | undefined): string | undefined {
  if (!node) {
    return undefined;
  }
  if (node.type === "JSXIdentifier" || node.type === "Identifier") {
    return node.name;
  }
  if (node.type === "JSXMemberExpression" || node.type === "MemberExpression") {
    const object = nodeName(node.object);
    const property = nodeName(node.property);
    return object && property ? `${object}.${property}` : undefined;
  }
  if (node.type === "JSXNamespacedName") {
    const namespace = nodeName(node.namespace);
    const name = nodeName(node.name);
    return namespace && name ? `${namespace}:${name}` : undefined;
  }
  return undefined;
}

function propertyName(node: AnyNode): string | undefined {
  if (node.type !== "ObjectProperty" && node.type !== "ObjectMethod") {
    return undefined;
  }
  if (node.computed) {
    return undefined;
  }
  if (node.key.type === "Identifier") {
    return node.key.name;
  }
  if (node.key.type === "StringLiteral") {
    return node.key.value;
  }
  return undefined;
}

function calleeName(node: AnyNode): string | undefined {
  if (node.type === "Identifier") {
    return node.name;
  }
  if (node.type === "MemberExpression" && !node.computed && node.property.type === "Identifier") {
    return node.property.name;
  }
  return undefined;
}

function isInsideType(ancestors: AnyNode[]): boolean {
  return ancestors.some((node) => TYPE_NODES.has(node.type));
}

function nearestAncestor(ancestors: AnyNode[], types: Set<string>): AnyNode | undefined {
  for (let index = ancestors.length - 1; index >= 0; index--) {
    if (types.has(ancestors[index].type)) {
      return ancestors[index];
    }
  }
  return undefined;
}

function isSafeChildExpression(node: AnyNode | undefined): boolean {
  if (!node) {
    return false;
  }
  switch (node.type) {
    case "Identifier":
    case "NumericLiteral":
    case "StringLiteral":
    case "BooleanLiteral":
    case "NullLiteral":
    case "MemberExpression":
      return true;
    case "TemplateLiteral":
      return node.expressions.every(isSafeChildExpression);
    case "BinaryExpression":
      return isSafeChildExpression(node.left) && isSafeChildExpression(node.right);
    case "UnaryExpression":
      return isSafeChildExpression(node.argument);
    case "LogicalExpression":
      return isSafeChildExpression(node.left) && isSafeChildExpression(node.right);
    case "ConditionalExpression":
      return isSafeChildExpression(node.consequent) && isSafeChildExpression(node.alternate);
    case "ParenthesizedExpression":
    case "TSAsExpression":
    case "TSSatisfiesExpression":
    case "TSNonNullExpression":
      return isSafeChildExpression(node.expression);
    default:
      return false;
  }
}

function flattenStringConcat(node: AnyNode): string[] | undefined {
  if (node.type === "StringLiteral") {
    return [node.value];
  }
  if (node.type === "BinaryExpression" && node.operator === "+") {
    const left = flattenStringConcat(node.left);
    const right = flattenStringConcat(node.right);
    if (left && right) {
      return [...left, ...right];
    }
  }
  return undefined;
}

function walk(
  node: AnyNode,
  visit: (node: AnyNode, ancestors: AnyNode[], key: string | null) => void,
  ancestors: AnyNode[] = [],
  key: string | null = null,
): void {
  if (!node || typeof node !== "object" || typeof node.type !== "string") {
    return;
  }

  visit(node, ancestors, key);

  const nextAncestors = [...ancestors, node];
  for (const childKey of Object.keys(node)) {
    if (SKIP_KEYS.has(childKey)) {
      continue;
    }
    const value = node[childKey];
    if (Array.isArray(value)) {
      for (const child of value) {
        if (child && typeof child === "object" && typeof child.type === "string") {
          walk(child, visit, nextAncestors, childKey);
        }
      }
    } else if (value && typeof value === "object" && typeof value.type === "string") {
      walk(value, visit, nextAncestors, childKey);
    }
  }
}

function snippet(code: string, start: number, end: number): string {
  const from = Math.max(0, start - 80);
  const to = Math.min(code.length, end + 80);
  const prefix = from > 0 ? "…" : "";
  const suffix = to < code.length ? "…" : "";
  return `${prefix}${code.slice(from, to).replaceAll(/\s+/g, " ").trim()}${suffix}`;
}

interface Edit {
  start: number;
  end: number;
  replacement: string;
  priority: number;
  key: string | null;
  line: number;
  column: number;
}

export function processCode(code: string, options: ProcessOptions): ProcessResult {
  const file = normalizeFile(options.file);
  const locale = options.locale ?? "zh-CN";
  const dictionary = options.dictionary ?? {};
  const collectOnly = options.collectOnly ?? false;

  let program: AnyNode;
  try {
    program = parseCode(code, file);
  } catch (error) {
    return {
      code,
      changed: false,
      candidates: [],
      usedKeys: [],
      runtimeKeys: [],
      parseError: error instanceof Error ? error.message : String(error),
    };
  }

  const candidates: Candidate[] = [];
  const candidateKeys = new Set<string>();
  const edits: Edit[] = [];
  const usedKeys = new Set<string>();
  const runtimeKeys = new Set<string>();

  const valibotNamespaces = new Set<string>();
  const valibotNamed = new Map<string, string>();

  for (const statement of program.body) {
    if (statement.type !== "ImportDeclaration" || statement.source.value !== "valibot") {
      continue;
    }
    for (const specifier of statement.specifiers) {
      if (specifier.type === "ImportNamespaceSpecifier") {
        valibotNamespaces.add(specifier.local.name);
      } else if (specifier.type === "ImportSpecifier") {
        const imported =
          specifier.imported.type === "Identifier"
            ? specifier.imported.name
            : specifier.imported.value;
        valibotNamed.set(specifier.local.name, imported);
      }
    }
  }

  function addCandidate(
    key: string,
    kind: CandidateKind,
    node: AnyNode,
    optional = false,
    contextStart = node.start,
    contextEnd = node.end,
  ): void {
    if (!/[A-Za-z]/.test(key)) {
      return;
    }
    const id = `${key}\0${node.start}\0${kind}`;
    if (candidateKeys.has(id)) {
      return;
    }
    candidateKeys.add(id);
    candidates.push({
      key,
      kind,
      file,
      line: node.loc?.start.line ?? 0,
      column: node.loc?.start.column ?? 0,
      context: snippet(code, contextStart, contextEnd),
      optional,
    });
  }

  function addEditRaw(
    key: string | null,
    start: number,
    end: number,
    replacement: string,
    priority: number,
    node: AnyNode,
  ): void {
    if (collectOnly) {
      return;
    }
    edits.push({
      start,
      end,
      replacement,
      priority,
      key,
      line: node.loc?.start.line ?? 0,
      column: node.loc?.start.column ?? 0,
    });
    if (key) {
      usedKeys.add(key);
      if (replacement.includes(`${RUNTIME_HELPER}(`)) {
        runtimeKeys.add(key);
      }
    }
  }

  function addStatic(
    key: string,
    kind: CandidateKind,
    node: AnyNode,
    priority: number,
    optional = false,
    contextStart = node.start,
    contextEnd = node.end,
  ): void {
    addCandidate(key, kind, node, optional, contextStart, contextEnd);
    if (collectOnly) {
      return;
    }
    const text = translationText(dictionary[key]);
    if (text === undefined) {
      return;
    }
    addEditRaw(key, node.start, node.end, jsString(text), priority, node);
  }

  function addJsxAttributeStatic(
    key: string,
    kind: CandidateKind,
    node: AnyNode,
    priority: number,
  ): void {
    addCandidate(key, kind, node);
    if (collectOnly) {
      return;
    }
    const text = translationText(dictionary[key]);
    if (text === undefined) {
      return;
    }
    addEditRaw(key, node.start, node.end, `{${jsString(text)}}`, priority, node);
  }

  function translateExpressionSource(node: AnyNode): string {
    switch (node.type) {
      case "StringLiteral": {
        const text = translationText(dictionary[node.value]);
        if (text === undefined) {
          return code.slice(node.start, node.end);
        }
        usedKeys.add(node.value);
        return jsString(text);
      }
      case "TemplateLiteral": {
        const quasis = node.quasis as AnyNode[];
        const expressions = node.expressions as AnyNode[];
        if (expressions.length === 0) {
          const key = quasis[0]?.value?.cooked ?? quasis[0]?.value?.raw ?? "";
          const text = translationText(dictionary[key]);
          if (text === undefined) {
            return code.slice(node.start, node.end);
          }
          usedKeys.add(key);
          return jsString(text);
        }

        let pattern = "";
        for (let index = 0; index < quasis.length; index++) {
          pattern += quasis[index]?.value?.cooked ?? quasis[index]?.value?.raw ?? "";
          if (index < expressions.length) {
            pattern += `{${index}}`;
          }
        }
        if (translationText(dictionary[pattern]) === undefined) {
          return code.slice(node.start, node.end);
        }

        usedKeys.add(pattern);
        runtimeKeys.add(pattern);
        const args = expressions.map((expression) => translateExpressionSource(expression));
        return `${RUNTIME_HELPER}(${jsString(pattern)}${args.length > 0 ? `, ${args.join(", ")}` : ""})`;
      }
      case "ConditionalExpression":
        return `(${code.slice(node.test.start, node.test.end)} ? ${translateExpressionSource(
          node.consequent,
        )} : ${translateExpressionSource(node.alternate)})`;
      case "LogicalExpression": {
        const left =
          node.operator === "&&"
            ? code.slice(node.left.start, node.left.end)
            : translateExpressionSource(node.left);
        return `(${left} ${node.operator} ${translateExpressionSource(node.right)})`;
      }
      case "BinaryExpression": {
        if (node.operator === "+") {
          const parts = flattenStringConcat(node);
          if (parts) {
            const key = parts.join("");
            const text = translationText(dictionary[key]);
            if (text !== undefined) {
              usedKeys.add(key);
              return jsString(text);
            }
          }
        }
        return code.slice(node.start, node.end);
      }
      case "ParenthesizedExpression":
      case "TSAsExpression":
      case "TSSatisfiesExpression":
      case "TSNonNullExpression":
        return `(${translateExpressionSource(node.expression)})`;
      default:
        return code.slice(node.start, node.end);
    }
  }

  function addTemplate(
    node: AnyNode,
    kind: CandidateKind,
    priority: number,
    optional = false,
  ): void {
    const quasis = node.quasis as AnyNode[];
    const expressions = node.expressions as AnyNode[];
    if (expressions.length === 0) {
      const key = quasis[0]?.value?.cooked ?? quasis[0]?.value?.raw ?? "";
      addStatic(key, kind, node, priority, optional);
      return;
    }

    let pattern = "";
    for (let index = 0; index < quasis.length; index++) {
      pattern += quasis[index]?.value?.cooked ?? quasis[index]?.value?.raw ?? "";
      if (index < expressions.length) {
        pattern += `{${index}}`;
      }
    }

    if (pattern.replaceAll(/\{\d+\}/g, "").trim().length < 3) {
      for (const expression of expressions) {
        addExpression(expression, kind, priority, optional, 1);
      }
      return;
    }

    addCandidate(pattern, kind, node, optional);
    const text = collectOnly ? undefined : translationText(dictionary[pattern]);
    if (text === undefined) {
      for (const expression of expressions) {
        addExpression(expression, kind, priority, optional, 1);
      }
      return;
    }

    const args = expressions.map((expression) => translateExpressionSource(expression));
    const replacement = `${RUNTIME_HELPER}(${jsString(pattern)}${
      args.length > 0 ? `, ${args.join(", ")}` : ""
    })`;
    addEditRaw(pattern, node.start, node.end, replacement, priority, node);
  }

  function addExpression(
    node: AnyNode | undefined,
    kind: CandidateKind,
    priority: number,
    optional = false,
    depth = 0,
  ): void {
    if (!node || depth > 20) {
      return;
    }

    switch (node.type) {
      case "StringLiteral":
        addStatic(node.value, kind, node, priority, optional);
        return;
      case "TemplateLiteral":
        addTemplate(node, kind, priority, optional);
        return;
      case "BinaryExpression": {
        if (node.operator !== "+") {
          return;
        }
        const parts = flattenStringConcat(node);
        if (!parts) {
          return;
        }
        const key = parts.join("");
        addCandidate(key, kind, node, optional);
        if (collectOnly) {
          return;
        }
        const text = translationText(dictionary[key]);
        if (text !== undefined) {
          addEditRaw(key, node.start, node.end, jsString(text), priority, node);
        }
        return;
      }
      case "ConditionalExpression":
        addExpression(node.consequent, kind, priority, optional, depth + 1);
        addExpression(node.alternate, kind, priority, optional, depth + 1);
        return;
      case "LogicalExpression":
        if (node.operator !== "&&") {
          addExpression(node.left, kind, priority, optional, depth + 1);
        }
        addExpression(node.right, kind, priority, optional, depth + 1);
        return;
      case "ParenthesizedExpression":
      case "TSAsExpression":
      case "TSSatisfiesExpression":
      case "TSNonNullExpression":
        addExpression(node.expression, kind, priority, optional, depth + 1);
        return;
      case "SequenceExpression":
        if (node.expressions.length > 0) {
          addExpression(
            node.expressions[node.expressions.length - 1],
            kind,
            priority,
            optional,
            depth + 1,
          );
        }
        return;
      default:
        return;
    }
  }

  function addObjectValues(node: AnyNode, kind: CandidateKind, priority: number): void {
    if (node.type !== "ObjectExpression") {
      addExpression(node, kind, priority);
      return;
    }
    for (const property of node.properties) {
      if (property.type === "ObjectProperty" && !property.computed) {
        addExpression(property.value, kind, priority);
      }
    }
  }

  function valibotFunction(callee: AnyNode): string | undefined {
    if (callee.type === "Identifier") {
      return valibotNamed.get(callee.name);
    }
    if (
      callee.type === "MemberExpression" &&
      !callee.computed &&
      callee.object.type === "Identifier" &&
      valibotNamespaces.has(callee.object.name) &&
      callee.property.type === "Identifier"
    ) {
      return callee.property.name;
    }
    return undefined;
  }

  function addCall(node: AnyNode, kind: CandidateKind): void {
    const name = calleeName(node.callee);

    if (name && DISPLAY_CALLS.has(name)) {
      addExpression(node.arguments[0], kind, 60);
      return;
    }

    if (name === "invalid") {
      for (const argument of node.arguments) {
        addObjectValues(argument, kind, 60);
      }
      return;
    }

    if (node.type === "NewExpression" && name === "ActionError") {
      addExpression(node.arguments[0], kind, 60);
      return;
    }

    const imported = valibotFunction(node.callee);
    if (!imported) {
      return;
    }
    const indices = VALIBOT_MESSAGE_ARGS[imported];
    if (!indices) {
      return;
    }
    for (const index of indices) {
      addExpression(node.arguments[index], "valibot", 60);
    }
  }

  function addJsxAttribute(node: AnyNode, ancestors: AnyNode[]): void {
    const name = nodeName(node.name);
    if (!name) {
      return;
    }

    const parent = ancestors[ancestors.length - 1];
    const component = parent?.type === "JSXOpeningElement" ? nodeName(parent.name) : undefined;

    if (file === "app/root.tsx" && name === "lang" && node.value?.type === "StringLiteral") {
      const localeValue = locale;
      if (node.value.value !== localeValue) {
        addEditRaw(null, node.value.start, node.value.end, jsString(localeValue), 90, node.value);
      }
      return;
    }

    if (component === "meta" && name === "content") {
      const viewport = (parent?.attributes ?? []).some(
        (attribute: AnyNode) =>
          attribute.type === "JSXAttribute" &&
          nodeName(attribute.name) === "name" &&
          attribute.value?.type === "StringLiteral" &&
          attribute.value.value === "viewport",
      );
      if (viewport) {
        return;
      }
    }

    const componentAttributes = component ? COMPONENT_ATTRIBUTES[component] : undefined;
    const display =
      DISPLAY_ATTRIBUTES.has(name) || (componentAttributes ? componentAttributes.has(name) : false);
    if (!display) {
      return;
    }

    if (node.value?.type === "StringLiteral") {
      addJsxAttributeStatic(node.value.value, "jsx-attribute", node.value, 80);
    } else if (node.value?.type === "JSXExpressionContainer") {
      addExpression(node.value.expression, "jsx-attribute", 80);
    }
  }

  function addJsxText(node: AnyNode, ancestors: AnyNode[]): void {
    const normalized = normalizeJsxText(node.value);
    const key = normalized.trim();
    if (!key) {
      return;
    }

    const element = nearestAncestor(
      ancestors,
      new Set(["JSXElement", "JSXFragment", "JSXAttribute"]),
    );
    addCandidate(key, "jsx-text", node, false, element?.start, element?.end);
    if (collectOnly) {
      return;
    }
    const text = translationText(dictionary[key]);
    if (text === undefined) {
      return;
    }

    const lead = /^\s/.test(normalized) ? '{" "}' : "";
    const trail = /\s$/.test(normalized) ? '{" "}' : "";
    addEditRaw(key, node.start, node.end, `${lead}{${jsString(text)}}${trail}`, 50, node);
  }

  function addJsxPattern(node: AnyNode): void {
    const children = (node.children as AnyNode[]).filter((child) => {
      if (child.type !== "JSXText") {
        return true;
      }
      return normalizeJsxText(child.value).trim().length > 0;
    });
    if (children.length < 2) {
      return;
    }

    const parts: string[] = [];
    const args: AnyNode[] = [];

    for (const child of children) {
      if (child.type === "JSXText") {
        parts.push(normalizeJsxText(child.value));
        continue;
      }
      if (
        child.type === "JSXExpressionContainer" &&
        child.expression.type !== "JSXEmptyExpression" &&
        isSafeChildExpression(child.expression)
      ) {
        parts.push(`{${args.length}}`);
        args.push(child.expression);
        continue;
      }
      return;
    }

    if (args.length === 0) {
      return;
    }

    const pattern = parts.join("").trim();
    const staticLength = pattern.replaceAll(/\{\d+\}/g, "").trim().length;
    if (staticLength < 10) {
      return;
    }

    const start = children[0].start;
    const end = children[children.length - 1].end;
    addCandidate(pattern, "jsx-pattern", node, true, start, end);
    if (collectOnly || translationText(dictionary[pattern]) === undefined) {
      return;
    }

    const replacement = `{${RUNTIME_HELPER}(${jsString(pattern)}${args
      .map((argument) => `, ${translateExpressionSource(argument)}`)
      .join("")})}`;
    addEditRaw(pattern, start, end, replacement, 100, node);
  }

  function addSpecialLocale(node: AnyNode): void {
    if (locale === "en") {
      return;
    }

    if (node.type === "NewExpression") {
      const name = nodeName(node.callee);
      if (name === "Intl.RelativeTimeFormat" || name === "Intl.DateTimeFormat") {
        const first = node.arguments[0];
        if (first?.type === "StringLiteral") {
          addEditRaw(null, first.start, first.end, jsString(locale), 90, first);
        }
      }
      return;
    }

    if (node.type === "CallExpression" && node.callee.type === "MemberExpression") {
      const method = nodeName(node.callee.property);
      if (method && DATE_METHODS.has(method) && node.arguments.length === 0) {
        const close = node.end - 1;
        if (code[close] === ")") {
          addEditRaw(null, close, close, jsString(locale), 90, node);
        }
      }
    }
  }

  walk(program, (node, ancestors) => {
    if (isInsideType(ancestors)) {
      return;
    }

    switch (node.type) {
      case "JSXText":
        addJsxText(node, ancestors);
        return;
      case "JSXAttribute":
        addJsxAttribute(node, ancestors);
        return;
      case "JSXExpressionContainer":
        if (ancestors[ancestors.length - 1]?.type !== "JSXAttribute") {
          addExpression(node.expression, "jsx-expression", 50);
        }
        return;
      case "JSXElement":
      case "JSXFragment":
        addJsxPattern(node);
        return;
      case "ObjectProperty": {
        const name = propertyName(node);
        const fileProperties = FILE_PROPERTIES[file];
        if (name && (DISPLAY_PROPERTIES.has(name) || fileProperties?.has(name))) {
          addExpression(node.value, "object-property", 60);
        }
        return;
      }
      case "VariableDeclarator":
        if (node.id.type === "Identifier" && DISPLAY_BINDERS.has(node.id.name)) {
          addExpression(node.init, "binder", 60);
        } else if (isLiteralFile(file)) {
          addExpression(node.init, "file-literal", 40);
        }
        return;
      case "ReturnStatement":
      case "ThrowStatement":
        if (isLiteralFile(file)) {
          addExpression(node.argument, "file-literal", 40);
          if (
            node.argument?.type === "NewExpression" &&
            node.argument.callee.type === "Identifier" &&
            (node.argument.callee.name === "Error" || node.argument.callee.name === "ActionError")
          ) {
            addExpression(node.argument.arguments[0], "file-literal", 40);
          }
        }
        return;
      case "AssignmentPattern":
        if (node.left.type === "Identifier" && DISPLAY_BINDERS.has(node.left.name)) {
          addExpression(node.right, "binder", 60);
        }
        return;
      case "AssignmentExpression":
        if (
          node.operator === "=" &&
          node.left.type === "Identifier" &&
          DISPLAY_BINDERS.has(node.left.name)
        ) {
          addExpression(node.right, "binder", 60);
        }
        return;
      case "CallExpression":
      case "NewExpression":
        addCall(node, "display-call");
        addSpecialLocale(node);
        return;
      default:
        return;
    }
  });

  const sorted = [...edits].sort(
    (left, right) =>
      left.start - right.start || right.end - left.end || right.priority - left.priority,
  );
  const kept: Edit[] = [];
  let lastEnd = -1;
  for (const edit of sorted) {
    if (edit.start < lastEnd) {
      continue;
    }
    kept.push(edit);
    lastEnd = edit.end;
  }

  if (kept.length === 0) {
    return {
      code,
      changed: false,
      candidates,
      usedKeys: [...usedKeys],
      runtimeKeys: [...runtimeKeys],
    };
  }

  let result = code;
  for (const edit of [...kept].sort((left, right) => right.start - left.start)) {
    result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end);
  }

  const needsRuntime = kept.some((edit) => edit.replacement.includes(`${RUNTIME_HELPER}(`));
  if (needsRuntime) {
    const bom = result.startsWith("\uFEFF") ? "\uFEFF" : "";
    const body = bom ? result.slice(1) : result;
    result = `${bom}import { __t as __hpT } from "${VIRTUAL_ID}";\n${body}`;
  }

  return {
    code: result,
    changed: true,
    candidates,
    usedKeys: [...usedKeys],
    runtimeKeys: [...runtimeKeys],
  };
}

export function collectCandidates(code: string, file: string, locale = "zh-CN"): Candidate[] {
  return processCode(code, { file, locale, collectOnly: true }).candidates;
}

export function transformCode(
  code: string,
  file: string,
  dictionary: Dictionary,
  locale = "zh-CN",
): ProcessResult {
  return processCode(code, { file, locale, dictionary });
}
