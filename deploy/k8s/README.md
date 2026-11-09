# k3s 部署

这些清单假定集群已有 Traefik、Longhorn 和 `stun-nat`。Headplane 使用 NodePort `30301`，`stun-nat` 新建一条独立规则把该端口暴露出去，EdgeOne 再把 `headplane.dddbg.com` 回源到 `stun-nat` 给出的公网地址。

## 1. 创建 Secret

```bash
kubectl apply -f deploy/k8s/00-namespace.yaml

kubectl -n headplane create secret generic headplane-secrets \
  --from-literal=cookie-secret="$(openssl rand -hex 16)" \
  --from-literal=headscale-api-key="replace-me" \
  --dry-run=client -o yaml | kubectl apply -f -
```

`cookie-secret` 必须是 32 个字符。`headscale-api-key` 先放占位值；拿到真实 API key 后：

```bash
kubectl -n headplane patch secret headplane-secrets --type merge \
  -p "{\"stringData\":{\"headscale-api-key\":\"$(cat /tmp/headscale-api-key)\"}}"
kubectl -n headplane rollout restart deploy/headplane
```

## 2. 配置 Headscale 地址

编辑 `headplane-config`：

```bash
kubectl -n headplane edit configmap headplane-config
```

把 `headscale-url` 改成实际的 Headscale 地址，例如：

- 集群内：`http://headscale.headscale.svc.cluster.local:8080`
- 外部：`https://headscale.example.com`

如果 EdgeOne/Traefik 会传 `X-Forwarded-Proto: https`，把 `cookie-secure` 改成 `"true"`；否则先保持 `"false"`。

## 3. 应用工作负载

```bash
kubectl apply -f deploy/k8s/01-configmap.yaml
kubectl apply -f deploy/k8s/02-pvc.yaml
kubectl apply -f deploy/k8s/04-service.yaml
kubectl apply -f deploy/k8s/03-deployment.yaml
kubectl apply -f deploy/k8s/05-ingress.yaml

kubectl -n headplane rollout status deploy/headplane
```

镜像默认是 `ghcr.io/hhqyb/headplane-zh:latest`。如果 GHCR 包仍是私有，需要创建 imagePullSecret 或把包设为 Public。

## 4. 验证

```bash
kubectl -n headplane get pods,svc,pvc,ingress
kubectl -n headplane port-forward svc/headplane 8080:3000
# 另开终端
curl -s http://127.0.0.1:8080/admin/login | grep -o '<html lang="[^"]*"'
```

集群内也可以直接访问 NodePort：

```bash
curl -s http://100.109.201.112:30301/admin/login | grep -o '<html lang="[^"]*"'
```

`/admin/healthz` 会检查 Headscale 健康状态；在 Headscale 地址还是占位值时它会返回 500，所以 Deployment 使用 TCP 探针而不是 healthz 探针。

## 5. stun-nat 与 EdgeOne

在 NodePort 可用后创建穿透规则：

```bash
./deploy/stun-nat/create-rule.sh
```

默认目标是 `192.168.100.2:30301`（和现有 gitea 规则同一台路由/节点）。如果该地址不通，可以覆盖：

```bash
TARGET_HOST=192.168.100.113 TARGET_PORT=30301 ./deploy/stun-nat/create-rule.sh
```

脚本会打印 `Public endpoint: http://<ip>:<port>`。在 EdgeOne 里给 `headplane.dddbg.com` 配置回源到该地址（HTTP），并确保 Host 为 `headplane.dddbg.com`。当前脚本不设置 Webhook；如果公网端口变化，需要更新 EdgeOne 源站，或参考现有 gitea 规则的 Webhook 机制自行配置。

## 清理

```bash
kubectl delete namespace headplane
```

`stun-nat` 规则不会随命名空间删除，需要在 stun-nat 控制台或 API 中删除。
