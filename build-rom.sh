#!/usr/bin/env bash
# Build the viewer ROM and record where its image data sits, into web/rom.
#
# The result is committed, because building it needs the rust-z80 fork and
# cargo-gb, which the page's own build has no use for:
#   https://github.com/zlfn/rust-gb
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

# Placeholders the ROM includes, filled with a run no real image would produce
# so each one can be found in the built ROM by its contents alone.
mkdir -p rom/res
python3 - <<'PY'
def blob(seed, n):
    out, x = bytearray(), seed
    for _ in range(n):
        x = (x * 1103515245 + 12345) & 0xFFFFFFFF
        out.append((x >> 16) & 0xFF)
    return bytes(out)

for name, seed, size in (("tiles", 0xA1B2C3D4, 5760),
                         ("palettes", 0x5E6F7A8B, 64),
                         ("attributes", 0x0F1E2D3C, 360)):
    open(f"rom/res/{name}.bin", "wb").write(blob(seed, size))
PY

( cd rom && cargo gb build )

python3 - <<'PY'
import glob, json, os, shutil

rom_path = glob.glob("rom/target/*.gb*")[0]
rom = open(rom_path, "rb").read()

offsets = {}
for name in ("tiles", "palettes", "attributes"):
    blob = open(f"rom/res/{name}.bin", "rb").read()
    at = rom.find(blob)
    if at < 0 or rom.count(blob[:32]) != 1:
        raise SystemExit(f"{name} is not in the ROM exactly once")
    offsets[name] = {"offset": at, "size": len(blob)}

os.makedirs("web/rom", exist_ok=True)
shutil.copyfile(rom_path, "web/rom/viewer.gbc")
json.dump(offsets, open("web/rom/offsets.json", "w"), indent=2)
print(f"web/rom/viewer.gbc ({len(rom) // 1024} KB)")
for name, o in offsets.items():
    print(f"  {name:11s} 0x{o['offset']:04X}  {o['size']} bytes")
PY
