#!/bin/sh
# Runs a command in one of 3 test slots. Each slot has its own copy of the test profile (models already
# downloaded), because Chrome lets only one browser open a profile. The slot's profile path is passed in
# EG_PROFILE, which tests/harness.mjs uses in place of .profile-test.
cd "$(dirname "$0")/.."
while :; do
  for n in 1 2 3; do
    if mkdir ".gpu.lock.$n" 2>/dev/null; then
      trap 'rmdir ".gpu.lock.'$n'"' EXIT INT TERM
      [ "$n" = 1 ] && EG_PROFILE="$PWD/.profile-test" || EG_PROFILE="$PWD/.profile-test-$n"
      export EG_PROFILE
      "$@"
      exit $?
    fi
  done
  sleep 2
done
