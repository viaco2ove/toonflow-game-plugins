"""
Compose generated tiles back into a full tileset PNG.
Takes the original PNG as base, overlays generated tiles at their original positions.
"""
import argparse
import json
import os
from PIL import Image


def compose(base_png, mapping_path, generated_dir, out_png, tile_size=32):
    """
    Args:
        base_png: original tileset PNG
        mapping_path: path to extract_mapping.json
        generated_dir: directory containing generated category PNGs
        out_png: output PNG path
    """
    base = Image.open(base_png).convert('RGBA')
    print(f"Base image: {base.size}")

    with open(mapping_path, 'r', encoding='utf-8') as f:
        mappings = json.load(f)

    total_placed = 0

    for cat, info in mappings.items():
        # Look for generated version
        gen_png_path = os.path.join(generated_dir, f"{cat}.png")
        if not os.path.exists(gen_png_path):
            print(f"  WARNING: No generated file for {cat}, skipping")
            continue

        gen_img = Image.open(gen_png_path).convert('RGBA')
        cols = info['cols']
        rows = info['rows']

        print(f"  Composing {cat}: {len(info['tiles'])} tiles from {gen_png_path}")

        for t in info['tiles']:
            # Extract tile from generated sheet
            sx = t['sheet_x'] * tile_size
            sy = t['sheet_y'] * tile_size
            tile = gen_img.crop((sx, sy, sx + tile_size, sy + tile_size))

            # Paste at original position
            dx = t['orig_x'] * tile_size
            dy = t['orig_y'] * tile_size
            base.paste(tile, (dx, dy), tile)
            total_placed += 1

    # Save output
    os.makedirs(os.path.dirname(out_png), exist_ok=True)
    base.save(out_png)
    print(f"\nTotal tiles placed: {total_placed}")
    print(f"Output saved to: {out_png}")
    print(f"Output size: {base.size}")


def main():
    parser = argparse.ArgumentParser(description='Compose generated tiles back into full tileset')
    parser.add_argument('--base-png', required=True, help='Original tileset PNG')
    parser.add_argument('--mapping', required=True, help='extract_mapping.json path')
    parser.add_argument('--generated-dir', required=True, help='Dir with generated category PNGs')
    parser.add_argument('--out-png', required=True, help='Output PNG path')
    parser.add_argument('--tile-size', type=int, default=32)
    args = parser.parse_args()

    compose(args.base_png, args.mapping, args.generated_dir, args.out_png, args.tile_size)
    print("\nDone!")


if __name__ == '__main__':
    main()
