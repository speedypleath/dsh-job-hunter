#!/bin/sh
set -eu

dsh_bin=${DSH_BIN:-.venv/bin/dsh}
test_dsh_home=$(mktemp -d /tmp/dsh-job-scout-boot.XXXXXX)

cleanup() {
  case "$test_dsh_home" in
    /tmp/dsh-job-scout-boot.*) rm -rf -- "$test_dsh_home" ;;
  esac
}
trap cleanup EXIT INT TERM

export DSH_HOME="$test_dsh_home"
"$dsh_bin" --profile sdk --dump-default-config >/dev/null
"$dsh_bin" plugin --profile sdk add --reporter=silent "file:$PWD/plugin"
"$dsh_bin" --profile sdk --dump-config | grep -q 'name: dsh-job-scout'
"$dsh_bin" --profile sdk </dev/null >/dev/null

echo "dsh_boot: pass"
