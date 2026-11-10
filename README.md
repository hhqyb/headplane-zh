# headplane-zh

Headplane 中文汉化覆盖层，以及用于构建多架构镜像和部署到 k3s 的配套文件。

部署包含两个服务，放在同一个 `headplane` namespace：

- **Headplane**：`https://headplane.dddbg.com`，中文管理界面，已启用内置 Agent
- **Headscale**：`https://hs.dddbg.com`，实际的 tailnet 控制服务器；Headplane 内部通过 `http://headscale:8080` 连接它

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
deploy/k8s/                   k3s 清单（Headplane + Headscale、NodePort、Traefik Ingress、Longhorn PVC）
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

## Headscale

- 版本：`ghcr.io/juanfont/headscale:0.29.5`
- 配置：`deploy/k8s/10-headscale-configmap.yaml`
- 数据：`headscale-data` Longhorn PVC，SQLite
- 对外：`https://hs.dddbg.com`，NodePort `30302`
- Headplane 内部地址：`http://headscale.headplane.svc.cluster.local:8080`
- 策略：`policy.mode: database`，Headplane 可以直接编辑 ACL
- DERP：使用 Tailscale 公共 DERP，不自己暴露 UDP

生成 Headplane 使用的 API key：

```bash
kubectl -n headplane exec deploy/headscale -- \
  headscale apikeys create --expiration 8760h
```

## 部署

见 [deploy/k8s/README.md](deploy/k8s/README.md)。要点：

- Namespace：`headplane`
- Headplane：NodePort `30301`，Ingress `headplane.dddbg.com`
- Headscale：NodePort `30302`，Ingress `hs.dddbg.com`
- `headscale-public-url` 控制页面显示的 `tailscale up --login-server` 地址
- `agent-enabled: "true"` 启用内置 Agent，节点名为 `headplane-agent`
- PVC：Longhorn 1Gi × 2
- Headplane 的 `headscale-url` 默认指向同 namespace 的 Headscale Service
- 生成 Headscale API key 后写入 `headplane-secrets`，重启 Headplane
- 通过 `stun-nat` 分别暴露两个 NodePort，再由 EdgeOne 回源

## 安全

- 仓库和镜像都是 Public，不包含 Headscale API key、cookie secret 或 EdgeOne 凭据。
- Kubernetes Secret 在部署时单独创建，不提交到 Git。
- `stun-nat` 规则默认不配置 Webhook，避免复制现有规则里的 EdgeOne 凭据。

## 限制

- Headscale 首次启动后需要生成 API key 并写入 `headplane-secrets`，否则 Headplane 无法登录。
- Headscale 的 `server_url` 是 `https://hs.dddbg.com`；EdgeOne 回源需要支持 WebSocket/HTTP2，否则 Tailscale 客户端无法完成控制连接。
- EdgeOne 的回源地址由 `stun-nat` 动态分配，公网端口可能变化；需要手动更新或自行配置 Webhook/DDNS。
- 汉化按英文原文匹配，上游改文案后新文案会回退英文，不会导致构建或运行时错误。

## License

覆盖层和配套脚本基于 Headplane 项目（MIT，Copyright (c) 2024 Aarnav Tale）。原 LICENSE 见 `LICENSE`。
