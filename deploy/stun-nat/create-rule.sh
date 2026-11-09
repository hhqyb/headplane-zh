#!/usr/bin/env bash
set -euo pipefail

STUN_NAT_URL="${STUN_NAT_URL:-http://100.109.201.112:31688}"
STUN_NAT_USER="${STUN_NAT_USER:-admin}"
STUN_NAT_PASSWORD="${STUN_NAT_PASSWORD:-}"
RULE_NAME="${RULE_NAME:-headplane-edgeone}"
TARGET_HOST="${TARGET_HOST:-192.168.100.2}"
TARGET_PORT="${TARGET_PORT:-30301}"

if [ -z "$STUN_NAT_PASSWORD" ]; then
  STUN_NAT_PASSWORD="$(kubectl -n stun-nat get secret stun-nat-credentials -o jsonpath='{.data.password}' | base64 -d)"
fi

auth=(-u "${STUN_NAT_USER}:${STUN_NAT_PASSWORD}")

existing="$(curl -fsS "${auth[@]}" "${STUN_NAT_URL}/api/rules" | node -e '
  let input = "";
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => {
    const rule = JSON.parse(input).rules.find((item) => item.name === process.argv[1]);
    if (rule) console.log(JSON.stringify({ id: rule.id, state: rule.state }));
  });
' "$RULE_NAME")"

if [ -n "$existing" ]; then
  echo "Rule already exists: $existing"
  exit 0
fi

body="$(node -e '
  console.log(JSON.stringify({
    name: process.argv[1],
    enabled: true,
    protocol: "tcp",
    bindPort: 0,
    stunServer: "turn.cloudflare.com:3478",
    keepaliveServer: "www.cloudflare.com:80",
    interval: 10,
    checkEvery: 1,
    probeInterval: 10,
    mode: "forward",
    targetHost: process.argv[2],
    targetPort: Number(process.argv[3]),
    routerMapping: "upnp",
    firewallAuto: false
  }));
' "$RULE_NAME" "$TARGET_HOST" "$TARGET_PORT")"

curl -fsS "${auth[@]}" \
  -H 'Content-Type: application/json' \
  -X POST \
  -d "$body" \
  "${STUN_NAT_URL}/api/rules" >/dev/null

echo "Created $RULE_NAME -> $TARGET_HOST:$TARGET_PORT"

for _ in $(seq 1 30); do
  state="$(curl -fsS "${auth[@]}" "${STUN_NAT_URL}/api/rules" | node -e '
    let input = "";
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => {
      const rule = JSON.parse(input).rules.find((item) => item.name === process.argv[1]);
      if (rule?.state?.publicAddress) {
        console.log(`${rule.state.publicAddress}:${rule.state.publicPort}`);
      }
    });
  ' "$RULE_NAME")"

  if [ -n "$state" ]; then
    echo "Public endpoint: http://$state"
    exit 0
  fi
  sleep 2
done

echo "Rule created, but no public endpoint yet. Check the stun-nat console." >&2
exit 1
