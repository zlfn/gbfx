#!/usr/bin/env bash
# Build the WebAssembly module and its bindings into web/pkg.
#
# Needs the wasm32 target and a matching wasm-bindgen-cli:
#   rustup target add wasm32-unknown-unknown
#   cargo install wasm-bindgen-cli --version <the wasm-bindgen version in Cargo.lock>
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

cargo build --release --manifest-path crate/Cargo.toml --target wasm32-unknown-unknown
wasm-bindgen --target web --no-typescript \
    --out-dir web/pkg \
    crate/target/wasm32-unknown-unknown/release/gb_image_fx_wasm.wasm

echo "built web/pkg ($(du -h web/pkg/gb_image_fx_wasm_bg.wasm | cut -f1))"
