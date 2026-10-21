#!/bin/sh
# Runs a command while holding the GPU/profile lock, so parallel smoke checks take turns on the one GPU
# and the shared .profile-test (which holds the downloaded models).
cd "$(dirname "$0")/.."
until mkdir .gpu.lock 2>/dev/null; do sleep 3; done
trap 'rmdir .gpu.lock' EXIT INT TERM
"$@"
