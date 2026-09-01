//! Shows one full-screen image, 160x144 of it, with every tile its own.
//!
//! A map entry is one byte, so a tile map reaches 256 tiles, and a full screen
//! needs 360. The screen is therefore drawn in two halves: the top nine rows
//! read tile data as unsigned from 0x8000, the bottom nine as signed from
//! 0x8800, and a STAT interrupt on LY=72 flips LCDC between the two. Laid out
//! that way both halves index with `cell & 0xff`, so the map is just a count.
//!
//! The three blobs are placeholders. The web build finds them in the ROM by
//! their contents and writes the real image over them.

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
/// The row the addressing mode changes on, and the scanline that is.
const SPLIT_ROW: usize = 9;
const SPLIT_LINE: u8 = (SPLIT_ROW * 8) as u8;

/// Base LCDC: background on, map at 0x9800, unsigned tile data, LCD running.
fn base_lcdc() -> Lcdc {
    Lcdc::new()
        .with_lcd_enable(true)
        .with_bg_window_enable(true)
        .with_tiledata_8000(true)
}

/// Half way down the screen the tile data area changes, and at the bottom it
/// changes back for the next frame.
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
    // Everything below writes VRAM, so the picture stays off until it is ready.
    unsafe { LCDC.write(Lcdc::new()) };
    SCX.write(0);
    SCY.write(0);

    for (i, chunk) in TILES.chunks_exact(16).enumerate().take(VRAM_TILES.len()) {
        let mut tile = [0u8; 16];
        tile.copy_from_slice(chunk);
        unsafe { core::ptr::write_volatile((0x8000 + i * 16) as *mut [u8; 16], tile) };
    }

    // Both halves land on the tile they need when the map just counts cells.
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
