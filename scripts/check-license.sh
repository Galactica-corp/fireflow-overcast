#!/usr/bin/env bash
# Verify Apache-2.0 LICENSE and SPDX headers on TypeScript sources.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

if ! grep -q "Apache License" LICENSE; then
  echo "LICENSE does not contain 'Apache License'" >&2
  exit 1
fi

if ! grep -q "Version 2.0" LICENSE; then
  echo "LICENSE does not contain 'Version 2.0'" >&2
  exit 1
fi

missing=0
while IFS= read -r -d '' file; do
  if ! grep -q "SPDX-License-Identifier: Apache-2.0" "$file"; then
    echo "missing SPDX header: $file" >&2
    missing=1
  fi
done < <(find src -name '*.ts' -print0; printf '%s\0' vitest.config.ts vitest.integration.config.ts)

if [[ "$missing" -ne 0 ]]; then
  exit 1
fi

if grep -R --include='*.ts' -n "Business Source License\|BUSL-1.1" src vitest.config.ts vitest.integration.config.ts >/dev/null; then
  echo "BUSL leftovers found in TypeScript sources" >&2
  grep -R --include='*.ts' -n "Business Source License\|BUSL-1.1" src vitest.config.ts vitest.integration.config.ts >&2
  exit 1
fi

echo "license check passed"
