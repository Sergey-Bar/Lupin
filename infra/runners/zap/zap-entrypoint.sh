#!/bin/sh
# The ZAP runner image's entrypoint (plan task 17). Two things only:
#
#   <image>                 prints ZAP's version (what `oci:smoke` checks);
#   <image> -t <url> ...    runs the baseline scan, `zap-baseline.py`, with the arguments the
#                           runner builds (`apps/runner/src/zap-execution.ts`).
#
# ZAP's own state goes to /tmp/zap in both cases, because the root filesystem is read-only and
# /tmp is the tmpfs. The baseline writes its report under /zap/wrk (mount it writable); there is
# no other mode, so an active scan cannot be asked for through this image.
set -eu
if [ "$#" -eq 0 ] || [ "$1" = "-version" ]; then
  exec zap.sh -dir /tmp/zap -version
fi
exec zap-baseline.py -z "-dir /tmp/zap" "$@"
