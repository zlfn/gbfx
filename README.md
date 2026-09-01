# gb-image-fx-web

[gb-image-fx](https://crates.io/crates/gb-image-fx) in the browser: drop in an
image and get the tile data, palettes, attributes and tile map a Game Boy or
Game Boy Color program loads.

**[zlfn.github.io/gb-image-fx-web](https://zlfn.github.io/gb-image-fx-web/)**

The conversion is the crate compiled to WebAssembly, so it runs on the page and
nothing is uploaded. It runs in a worker, since a dithered reduction takes a
second or two.

## Building

```
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version <the wasm-bindgen version in crate/Cargo.lock>
./build.sh
```

That writes `web/pkg`. Serve `web` over HTTP — modules and WebAssembly will not
load from `file://`:

```
python3 -m http.server --directory web
```

## Layout

| Path | |
|---|---|
| `crate/` | a cdylib that links the crate's browser entry point |
| `web/` | the page, served as-is |
| `build.sh` | builds `web/pkg` |
