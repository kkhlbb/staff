#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
source "$here/versions.env"
work="${OCCT_BUILD_DIR:-${TMPDIR:-/tmp}/cunlian-occt-build}"
out="${OCCT_OUTPUT_DIR:-$root/vendor/occt-unified}"
mkdir -p "$work" "$out"
work="$(cd "$work" && pwd)"
out="$(cd "$out" && pwd)"

test "$(cmake --version | sed -n '1s/cmake version //p')" = "$CMAKE_VERSION"
test "$(ninja --version)" = "$NINJA_VERSION"
emcc_version="$(emcc --version)"
if [[ "$emcc_version" != *" $EMSDK_VERSION ($EMSCRIPTEN_COMMIT)"* ]]; then
  echo "Activate emsdk $EMSDK_VERSION ($EMSDK_COMMIT) before building" >&2
  exit 1
fi
export LC_ALL=C TZ=UTC SOURCE_DATE_EPOCH=0
archive="$work/occt.tar.gz"
url="https://codeload.github.com/Open-Cascade-SAS/OCCT/tar.gz/refs/tags/V$OCCT_VERSION"
if [[ ! -f "$archive" ]]; then
  curl --fail --location --retry 3 "$url" -o "$archive.download"
  mv "$archive.download" "$archive"
fi
printf '%s  %s\n' "$OCCT_SHA256" "$archive" | shasum -a 256 -c -
source_dir="$work/OCCT-$OCCT_VERSION"
# Always re-extract verified source so a dirty source tree cannot affect output.
rm -rf "$source_dir"
tar -xf "$archive" -C "$work"
# A Wasm VM does not deliver Unix process signals to OCCT. Its setjmp-based
# signal conversion also conflicts with native Wasm exception handling.
flags="-O2 -UOCC_CONVERT_SIGNALS -fwasm-exceptions -ffile-prefix-map=$work=/build"
emcmake cmake -G Ninja -S "$source_dir" -B "$work/build" \
  -DCMAKE_BUILD_TYPE=Release "-DCMAKE_CXX_FLAGS_RELEASE=$flags -DNDEBUG" \
  "-DCMAKE_C_FLAGS_RELEASE=$flags -DNDEBUG" \
  "-DCMAKE_PROJECT_OCCT_INCLUDE=$here/wasm-codegen.cmake" \
  -DBUILD_LIBRARY_TYPE=Static \
  -DBUILD_MODULE_FoundationClasses=OFF -DBUILD_MODULE_ModelingData=OFF \
  -DBUILD_MODULE_ModelingAlgorithms=OFF -DBUILD_MODULE_Visualization=OFF \
  -DBUILD_MODULE_ApplicationFramework=OFF -DBUILD_MODULE_DataExchange=OFF \
  -DBUILD_MODULE_DETools=OFF -DBUILD_MODULE_Draw=OFF \
  '-DBUILD_ADDITIONAL_TOOLKITS=TKPrim TKBool TKFillet TKOffset TKHLR TKMesh TKDESTEP TKXCAF TKBinXCAF' \
  -DUSE_FREETYPE=OFF -DUSE_OPENGL=OFF -DUSE_GLES2=OFF -DUSE_XLIB=OFF -DUSE_TBB=OFF
cmake --build "$work/build" --parallel "${JOBS:-8}"
[[ "${OCCT_COMPILE_ONLY:-0}" != 1 ]] || exit 0
test "$(tsc --version)" = "Version $TYPESCRIPT_VERSION"
spacer="$root/vendor/step-narrow-v1/spacer.cpp"
printf '%s  %s\n' "$SPACER_SHA256" "$spacer" | shasum -a 256 -c -
libs=()
while IFS= read -r lib; do libs+=("$lib"); done < <(find "$work/build" -name 'libTK*.a' | sort)
test "${#libs[@]}" -gt 0
# The pinned spacer translation unit is the existing product ABI.
stage="$(mktemp -d "$out/.occt-stage.XXXXXX")"
trap 'rm -rf "$stage"' EXIT
# Keep DWARF for the binding and spacer boundaries while Track X is integrated.
# OCCT library objects use the optimization levels configured above.
em++ -std=c++17 -O0 -g3 -fwasm-exceptions -fdebug-compilation-dir=/cunlian -ffile-prefix-map="$root=/cunlian" \
  -ffile-prefix-map="$work=/build" -I"$work/build/include/opencascade" "$here/bindings.cpp" "$here/xcaf.cpp" "$spacer" \
  -Wl,--start-group "${libs[@]}" -Wl,--end-group --bind \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=node -sALLOW_MEMORY_GROWTH=1 -sSTACK_SIZE=8388608 \
  -sFORCE_FILESYSTEM=1 '-sEXPORTED_RUNTIME_METHODS=["FS","wasmMemory","getExceptionMessage","decrementExceptionRefcount"]' \
  '-sEXPORTED_FUNCTIONS=["_spacer_step"]' -sEXPORT_EXCEPTION_HANDLING_HELPERS=1 \
  --emit-tsd "$stage/cunlian_occt.d.mts" -o "$stage/cunlian_occt.mjs"
for artifact in cunlian_occt.wasm cunlian_occt.mjs cunlian_occt.d.mts; do
  test -s "$stage/$artifact"
  chmod 0644 "$stage/$artifact"
  mv "$stage/$artifact" "$out/$artifact"
done
