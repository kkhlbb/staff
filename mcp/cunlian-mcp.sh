#!/bin/sh
set -eu
bridge_dir="$(CDPATH= cd -- "$(/usr/bin/dirname -- "$0")" && pwd -P)"
contents_dir="$(CDPATH= cd -- "$bridge_dir/../.." && pwd -P)"
executable="$contents_dir/MacOS/寸链"
unset NODE_OPTIONS ELECTRON_NO_ASAR
ELECTRON_RUN_AS_NODE=1 exec "$executable" "$bridge_dir/local-bridge.mjs" "$executable"
