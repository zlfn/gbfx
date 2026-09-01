//! Shows one full-screen image. The three blobs are placeholders; the web build
//! finds them in the ROM by their contents and writes the real image over them.

#![no_std]
#![no_main]
#![feature(abi_z80_interrupt)]

use gb::mmio::cgb::{BCPD, BCPS, PaletteIndex, VBK};
use gb::mmio::{
    BGP, Interrupts, LCDC, LYC, Lcdc, Palette, SCX, SCY, STAT, Shade, Stat, TILEMAP_0, VRAM_TILES,
};

static TILES: &[u8] = include_bytes!("../res/tiles.bin");
static PALETTES: &[u8] = include_bytes!("../res/palettes.bin");
static ATTRIBUTES: &[u8] = include_bytes!("../res/attributes.bin");

const COLS: usize = 20;
const ROWS: usize = 18;
const SPLIT_LINE: u8 = 72;

fn base_lcdc() -> Lcdc {
    Lcdc::new()
        .with_lcd_enable(true)
        .with_bg_window_enable(true)
        .with_tiledata_8000(true)
}

/// A map entry reaches 256 tiles and a screen needs 360, so the halves read
/// tile data from different areas. This swaps them, every frame.
#[gb_rt::interrupt(LcdStat)]
fn split() {
    unsafe {
        if LYC.read() == SPLIT_LINE {
            LCDC.write(base_lcdc().with_tiledata_8000(false));
            LYC.write(144);
        } else {
            LCDC.write(base_lcdc());
            LYC.write(SPLIT_LINE);
        }
    }
}

fn main() -> ! {
    unsafe { LCDC.write(Lcdc::new()) };
    SCX.write(0);
    SCY.write(0);

    for (i, chunk) in TILES.chunks_exact(16).enumerate().take(VRAM_TILES.len()) {
        let mut tile = [0u8; 16];
        tile.copy_from_slice(chunk);
        unsafe { core::ptr::write_volatile((0x8000 + i * 16) as *mut [u8; 16], tile) };
    }

    // Both halves land on the right tile when the map just counts cells.
    for row in 0..ROWS {
        for col in 0..COLS {
            TILEMAP_0.index(col, row).write((row * COLS + col) as u8);
        }
    }

    if gb::is_cgb() {
        VBK.write(1);
        for row in 0..ROWS {
            for col in 0..COLS {
                TILEMAP_0.index(col, row).write(ATTRIBUTES[row * COLS + col]);
            }
        }
        VBK.write(0);

        BCPS.write(PaletteIndex::new().with_address(0).with_auto_increment(true));
        for &byte in PALETTES {
            BCPD.write(byte);
        }
    } else {
        BGP.write(
            Palette::new()
                .with_id0(Shade::White)
                .with_id1(Shade::LightGray)
                .with_id2(Shade::DarkGray)
                .with_id3(Shade::Black),
        );
    }

    LYC.write(SPLIT_LINE);
    STAT.write(Stat::new().with_lyc_int(true));
    unsafe { gb::interrupt::set_enabled(Interrupts::LCD_STAT) };
    unsafe { LCDC.write(base_lcdc()) };
    unsafe { gb::interrupt::enable() };

    // Nothing left to do; the split runs on its own from here.
    loop {
        gb::interrupt::halt();
    }
}

#[gb_rt::entry]
fn entry() -> ! {
    main()
}

#[panic_handler]
fn panic(_info: &core::panic::PanicInfo) -> ! {
    loop {}
}
