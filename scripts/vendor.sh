#!/bin/sh
# Builds legacy/vendor from node_modules. Each scripts/vendor.d/*.sh owns (and clears) its own subfolder.
set -e
cd "$(dirname "$0")/.."
mkdir -p legacy/vendor
for s in scripts/vendor.d/*.sh; do sh "$s"; done
