# gb-image-fx-web

[gb-image-fx](https://crates.io/crates/gb-image-fx) in the browser: drop in an
image and get the tile data, palettes, attributes and tile map a Game Boy or
Game Boy Color program loads.

**[zlfn.github.io/gb-image-fx-web](https://zlfn.github.io/gb-image-fx-web/)**

The conversion is the crate compiled to WebAssembly, so it runs on the page and
nothing is uploaded. It runs in a worker, since a dithered reduction takes a
second or two.

## The viewer ROM

A full-screen conversion can also be downloaded as a Game Boy ROM: the page
writes the tiles, palettes and attributes into a prebuilt program and fixes the
cartridge checksum, so the result runs in an emulator or on hardware. A Game
Boy image comes back as a `.gb` with the header's colour flag cleared, which
the ROM reads as well, so it takes its four shades from BGP.

`rom/` is that program, and `web/rom` holds it built along with the offsets of
the three blobs the page writes over.
A map entry is one byte, so a tile map reaches 256 tiles while a full screen
needs 360; the ROM draws the top nine rows with unsigned tile indices and the
bottom nine with signed ones, flipping `LCDC` on a `STAT` interrupt at LY=72.

The built ROM is committed, since making it needs the [rust-z80
fork](https://github.com/zlfn/rust-gb) and `cargo gb`, which the page's own
build has no use for. With those in hand, `cargo gb build` inside `rom/` gives
a new one; the offsets in `web/rom/offsets.json` are where each placeholder
lands, found by searching the ROM for the placeholder's contents.

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
| `rom/` | the Game Boy viewer the page patches an image into |
| `web/` | the page, served as-is |
| `build.sh` | builds `web/pkg` |
