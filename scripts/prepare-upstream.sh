#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ref="${UPSTREAM_REF:-$(tr -d '\r\n' < "$root/upstream-ref.txt")}"
repo="${UPSTREAM_REPO_URL:-https://github.com/tale/headplane.git}"

if [ -z "$ref" ]; then
  echo "upstream-ref.txt is empty" >&2
  exit 1
fi

rm -rf "$root/upstream"
git init -q "$root/upstream"
git -C "$root/upstream" remote add origin "$repo"
git -C "$root/upstream" fetch -q --depth 1 origin "$ref"
git -C "$root/upstream" checkout -q --detach FETCH_HEAD

commit="$(git -C "$root/upstream" rev-parse --short HEAD)"

rm -rf "$root/upstream/i18n"
cp -R "$root/i18n" "$root/upstream/i18n"
rm -rf "$root/upstream/i18n/reports"

if ! git -C "$root/upstream" apply --check "$root/overlay/vite-config-i18n.patch"; then
  echo "Failed to apply overlay/vite-config-i18n.patch to upstream $ref ($commit)." >&2
  echo "Update the patch for the new vite.config.ts and try again." >&2
  exit 1
fi

git -C "$root/upstream" apply "$root/overlay/vite-config-i18n.patch"
rm -rf "$root/upstream/.git"
printf '%s\n' "$commit" > "$root/.prepared-version"
echo "Prepared upstream $ref ($commit)"
