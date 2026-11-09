# Headplane 中文汉化覆盖层

这是一个构建期汉化层，不修改 `app/` 下的业务源码。默认构建中文界面，未翻译或上游新增的文案会自动保留英文。

## 为什么不会影响上游更新

- 所有翻译、提取、检查逻辑都在 `i18n/` 目录内。
- 唯一的上游改动是 `vite.config.ts` 里的两行插件注册。
- 不新增 npm 依赖，不改 `package.json`、`pnpm-lock.yaml`、`Dockerfile` 或 `tsconfig.json`。
- 字典按英文原文匹配；上游改文案后旧翻译失效、新文案显示英文，不会导致构建或运行时错误。
- 上游新增页面或组件时，未命中的文案原样显示英文。

## 使用

默认行为（不设置环境变量）：

```bash
pnpm build
```

产出中文界面。

英文原版：

```bash
HEADPLANE_LOCALE=en pnpm build
# 或 HEADPLANE_LOCALE=off
```

开发模式：

```bash
pnpm dev
```

`HEADPLANE_LOCALE=en pnpm dev` 可在开发时关闭汉化。

## 目录

```
i18n/
  plugin.ts              Vite 插件：加载 locale、改写源码、生成运行时模块
  transform.ts           AST 改写核心，插件和脚本共用
  locales/zh-CN.json     扁平字典：英文原文 -> 中文
  allowlist.json         有意保留英文的 key（品牌、代码标识、示例值）
  scripts/
    extract.ts           扫描 app/，输出缺失清单和上下文
    check.ts             检查缺失、未使用、占位符、空翻译
    apply.ts             校验并合并一批翻译
  reports/               生成物（已 gitignore）
tests/unit/i18n/
  transform.test.ts      转换核心的单元测试
```

## 翻译工作流

1. 提取当前候选文案：

   ```bash
   node i18n/scripts/extract.ts
   ```

   报告在 `i18n/reports/untranslated.md` 和 `untranslated.json`。

2. 编辑 `i18n/locales/zh-CN.json`。key 必须与报告中的英文原文完全一致。

3. 检查：

   ```bash
   node i18n/scripts/check.ts
   ```

   缺失、占位符错误会以非零退出码结束。

4. 构建验证：

   ```bash
   HEADPLANE_LOCALE=zh-CN pnpm build
   ```

### 批量合并

如果有一批现成的翻译，可以写成 JSON 对象，然后用：

```bash
node i18n/scripts/apply.ts path/to/batch.json
```

`apply.ts` 会拒绝不在提取结果中的 key，避免手写 key 拼错。合并后自动按 key 排序。

### 占位符

模板文案使用 `{0}`、`{1}`：

```json
{
  "A user named {0} already exists.": "名为 {0} 的用户已存在。",
  "This {0} is already in the list.": {
    "text": "这个{0}已在列表中。",
    "values": { "domain": "域名", "group": "组", "user": "用户" }
  }
}
```

- 翻译可以使用或省略 key 中的占位符（例如中文不区分单复数）。
- 翻译不能引入 key 中不存在的占位符，否则 `check.ts` 报错。
- 少数英文单复数后缀（如 `s`）会故意翻译为空字符串，`check.ts` 会给出警告但不会失败。
- `values` 用于把插值参数里的英文枚举值（`domain`/`group`/`user`）映射成中文。

## 更新上游

1. `git fetch upstream && git rebase upstream/main`（或 merge）。
2. 如果 `vite.config.ts` 冲突，保留 `headplaneI18n()` 的 import 和插件注册即可。
3. `pnpm install`。
4. `node i18n/scripts/check.ts`：新文案会出现在 missing，旧 key 会出现在 unused。
5. 补新文案，重新构建。

## Docker / Nix

现有 `Dockerfile` 的 `js-base` 阶段会 `COPY . .` 并执行 `./build.sh --app`，所以默认会构建中文版，无需改 Dockerfile：

```bash
docker build -t headplane:zh .
```

`nix/package.nix` 走 `pnpm build`，同样自动生效。

## 新增语言

1. 复制 `i18n/locales/zh-CN.json` 为 `i18n/locales/<locale>.json` 并翻译。
2. 用 `HEADPLANE_LOCALE=<locale> pnpm build` 构建。

不需要运行时代码改动。英文（`en`/`off`）始终是内建的回退。

## 已知限制

- 字典按完整英文原文匹配。上游改一个单词，旧翻译就不再匹配，界面回退英文。
- Headscale 返回的原始错误、用户/设备名称、节点数据保持原文。
- 文本中嵌套多个元素、语序差异很大的句子按片段翻译。`untranslated.md` 会给出上下文；必要时逐条润色。
- 少数纯符号片段（例如句末的 `.`）不会翻译。
- `@babel/parser` 从 `@react-router/dev` 的依赖中解析，用于构建期 AST 改写。如果上游调整了该依赖，插件会打印警告并回退英文构建；此时可显式安装 `@babel/parser` 作为 devDependency。
- 不修改根 `CHANGELOG.md`，避免和上游发布记录冲突；汉化说明以本文件为准。

## 验证

```bash
node i18n/scripts/check.ts
pnpm typecheck
pnpm test:unit
HEADPLANE_LOCALE=zh-CN pnpm build
HEADPLANE_LOCALE=en pnpm build
```
