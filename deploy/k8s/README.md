# k3s 部署

这些清单把 Headplane 和 Headscale 放在同一个 `headplane` namespace：

- Headplane：`https://headplane.dddbg.com`，NodePort `30301`
- Headscale：`https://hs.dddbg.com`，NodePort `30302`
- Headplane 内部通过 `http://headscale.headplane.svc.cluster.local:8080` 连接 Headscale
- 外部通过 `stun-nat` 暴露两个 NodePort，再由 EdgeOne 回源

## 1. Namespace 和 Secret

```bash
kubectl apply -f deploy/k8s/00-namespace.yaml

kubectl -n headplane create secret generic headplane-secrets \
  --from-literal=cookie-secret="$(openssl rand -hex 16)" \
  --from-literal=headscale-api-key="replace-me" \
  --dry-run=client -o yaml | kubectl apply -f -
```

`cookie-secret` 必须是 32 个字符。`headscale-api-key` 先放占位值，第 4 步生成真正的 key 后更新。

## 2. 部署 Headscale

```bash
kubectl apply -f deploy/k8s/10-headscale-configmap.yaml
kubectl apply -f deploy/k8s/11-headscale-pvc.yaml
kubectl apply -f deploy/k8s/12-headscale-service.yaml
kubectl apply -f deploy/k8s/13-headscale-deployment.yaml
kubectl apply -f deploy/k8s/14-headscale-ingress.yaml

kubectl -n headplane rollout status deploy/headscale
curl -s http://100.109.201.112:30302/health
```

Headscale 配置在 `10-headscale-configmap.yaml`：

- `server_url: https://hs.dddbg.com`
- `listen_addr: 0.0.0.0:8080`
- SQLite：`/var/lib/headscale/db.sqlite`
- 策略：`policy.mode: database`，方便 Headplane 可视化编辑 ACL
- MagicDNS：`tailnet.dddbg.com`
- DERP：使用 Tailscale 公共 DERP，不自己暴露 UDP
- 镜像：`ghcr.io/juanfont/headscale:0.29.5`

Headscale 启动时日志里会有 `listening without TLS but ServerURL does not start with http://`，这是正常的：TLS 由 EdgeOne 终止。

## 3. 部署 Headplane

```bash
kubectl apply -f deploy/k8s/01-configmap.yaml
kubectl apply -f deploy/k8s/02-pvc.yaml
kubectl apply -f deploy/k8s/04-service.yaml
kubectl apply -f deploy/k8s/03-deployment.yaml
kubectl apply -f deploy/k8s/05-ingress.yaml

kubectl -n headplane rollout status deploy/headplane
```

Headplane 的 `headscale-url` 已经默认指向同 namespace 的 Headscale Service。

## 4. 生成 Headscale API key 并接入 Headplane

```bash
kubectl -n headplane exec deploy/headscale -- \
  headscale apikeys create --expiration 8760h
```

复制输出的 `hskey-api-...`，然后：

```bash
kubectl -n headplane patch secret headplane-secrets --type merge \
  -p '{"stringData":{"headscale-api-key":"粘贴刚才的 hskey-api-..."}}'
kubectl -n headplane rollout restart deploy/headplane
kubectl -n headplane rollout status deploy/headplane
```

验证：

```bash
curl -s http://100.109.201.112:30301/admin/healthz
# {"status":"OK"}
```

然后用这个 API key 在 Headplane 登录页登录。Headplane 会显示 `Connected to Headscale 0.29.5`。

## 5. stun-nat 与 EdgeOne

先确认 NodePort 可达（两条规则的目标都是 `192.168.100.2`）：

```bash
RULE_NAME=headplane-edgeone TARGET_PORT=30301 ./deploy/stun-nat/create-rule.sh
RULE_NAME=headscale-edgeone TARGET_PORT=30302 ./deploy/stun-nat/create-rule.sh
```

脚本会打印 `Public endpoint: http://<public-ip>:<port>`。当前示例：

- Headplane：`http://101.228.82.184:15027`
- Headscale：`http://101.228.82.184:12881`

在 EdgeOne 中配置：

| 域名 | 回源 |
| --- | --- |
| `headplane.dddbg.com` | `http://<headplane-public-ip>:<port>` |
| `hs.dddbg.com` | `http://<headscale-public-ip>:<port>` |

Headscale 的 `server_url` 是 `https://hs.dddbg.com`，客户端会走 HTTPS/WebSocket；EdgeOne 需要支持 WebSocket/HTTP2 回源。如果 EdgeOne 不支持，需要改用 TCP 端口映射或其它反向代理。

`stun-nat` 的公网端口会变化。两条规则默认没有 Webhook；要长期稳定，建议在 stun-nat 控制台给规则配置 EdgeOne Webhook/DDNS，或者在端口变化时更新 EdgeOne 源站。

## 6. 常用配置

- 改 Headscale 域名：编辑 `10-headscale-configmap.yaml` 的 `server_url`，重启 Headscale，同时更新 EdgeOne 和 Headplane 的 `base-url`（如果头界面域名也变）。
- 改 Headplane 域名：编辑 `01-configmap.yaml` 的 `base-url` 和 `05-ingress.yaml` 的 host，重启 Headplane。
- 改 Headplane 的 Headscale 地址：编辑 `01-configmap.yaml` 的 `headscale-url`。
- `cookie-secure`：如果 EdgeOne/Traefik 会传 `X-Forwarded-Proto: https`，设为 `"true"`；否则先保持 `"false"`。
- Headscale 数据：`headscale-data` PVC；删除 namespace 会删除 PVC 和所有 tailnet 数据。

## 7. 清理

```bash
kubectl delete namespace headplane
```

`stun-nat` 规则不会随 namespace 删除，需要在 stun-nat 控制台或 API 中删除。
