# headplane-zh

Headplane 中文汉化覆盖层，以及用于构建多架构镜像和部署到 k3s 的配套文件。

这个仓库不保存 Headplane 源码。GitHub Actions 会按 `upstream-ref.txt` 拉取上游固定提交，把 `i18n/` 覆盖层复制进去，应用 `overlay/vite-config-i18n.patch`，然后用上游 Dockerfile 构建 `linux/amd64` 和 `linux/arm64` 镜像。

如果本地网络访问 GitHub 不稳定，可以设置 `UPSTREAM_REPO_URL` 指向镜像或本地路径：

```bash
UPSTREAM_REPO_URL=https://gh-proxy.org/https://github.com/tale/headplane.git \
  ./scripts/prepare-upstream.sh
```

## 目录

```
i18n/                         中文翻译、提取/检查脚本、构建期 Vite 插件
overlay/vite-config-i18n.patch 给上游 vite.config.ts 加两行插件注册
upstream-ref.txt              当前构建的上游提交
scripts/prepare-upstream.sh   拉取上游 + 覆盖 + 打补丁
.github/workflows/build-image.yaml
deploy/k8s/                   k3s 清单（NodePort 30301、Traefik Ingress、Longhorn PVC）
deploy/stun-nat/              创建 stun-nat 穿透规则的脚本
```

## 镜像

工作流推送到 GHCR：

```
ghcr.io/hhqyb/headplane-zh:latest
ghcr.io/hhqyb/headplane-zh:sha-<短提交>
```

- 默认分支推送产 `latest`。
- 推送 `v*` 标签产同名 tag。
- 手动触发可以覆盖 `upstream_ref`，不填则用 `upstream-ref.txt`。

多架构构建使用 QEMU + buildx，首次构建会拉取上游的 Go/Node 依赖，耗时会比较长。

## 更新上游

1. 修改 `upstream-ref.txt` 为新的 commit/tag/branch，或手动触发 workflow 并填写 `upstream_ref`。
2. 如果 `vite.config.ts` 结构变化导致补丁应用失败，构建会明确报错。更新 `overlay/vite-config-i18n.patch` 后重跑。
3. 新版本可能有新增文案。更新后可以在本仓库运行：

   ```bash
   node i18n/scripts/check.ts
   ```

   它会报告缺失 key。补进 `i18n/locales/zh-CN.json` 即可。

## 本地构建

需要 Docker 和 buildx：

```bash
./scripts/prepare-upstream.sh
docker buildx build --platform linux/amd64,linux/arm64 \
  --build-arg HEADPLANE_VERSION="$(cat .prepared-version)" \
  -t ghcr.io/hhqyb/headplane-zh:dev \
  -f upstream/Dockerfile upstream
```

## 部署

见 [deploy/k8s/README.md](deploy/k8s/README.md)。要点：

- Namespace：`headplane`
- NodePort：`30301`
- Ingress：`headplane.dddbg.com`（Traefik）
- PVC：Longhorn 1Gi
- Headscale 地址和 API key 先用占位值，之后通过 ConfigMap/Secret 更新
- 通过 `stun-nat` 新建一条独立规则暴露 NodePort，再由 EdgeOne 回源

## 安全

- 仓库和镜像都是 Public，不包含 Headscale API key、cookie secret 或 EdgeOne 凭据。
- Kubernetes Secret 在部署时单独创建，不提交到 Git。
- `stun-nat` 规则默认不配置 Webhook，避免复制现有规则里的 EdgeOne 凭据。

## 限制

- Headplane 需要连接 Headscale 才能登录；当前清单里的 `headscale-url` 是占位值，部署后需要更新。
- EdgeOne 的回源地址由 `stun-nat` 动态分配，公网端口可能变化；需要手动更新或自行配置 Webhook/DDNS。
- 汉化按英文原文匹配，上游改文案后新文案会回退英文，不会导致构建或运行时错误。

## License

覆盖层和配套脚本基于 Headplane 项目（MIT，Copyright (c) 2024 Aarnav Tale）。原 LICENSE 见 `LICENSE`。
