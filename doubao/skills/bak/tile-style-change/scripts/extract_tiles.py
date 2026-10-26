"""
Extract tiles from a compiled tileset PNG, grouped by category.
Outputs one small PNG per category + a mapping JSON for later composition.
"""
import argparse
import json
import os
from PIL import Image


def load_tileset(json_path):
    with open(json_path, 'r', encoding='utf-8') as f:
        return json.load(f)


def get_category_tiles(tiles_data, target_categories):
    """Return list of (tile_id, grid_x, grid_y, category) for target categories."""
    result = []
    for tile in tiles_data.get('tiles', []):
        props = {p['name']: p['value'] for p in tile.get('properties', [])}
        cat = props.get('category', '')
        if cat in target_categories:
            result.append({
                'id': tile['id'],
                'x': props.get('grid_x', 0),
                'y': props.get('grid_y', 0),
                'category': cat
            })
    return result


def extract_and_group(img_path, tiles_data, target_categories, out_dir, tile_size=32):
    img = Image.open(img_path).convert('RGBA')
    os.makedirs(out_dir, exist_ok=True)

    # Group tiles by category
    by_cat = {}
    all_tiles = get_category_tiles(tiles_data, target_categories)
    for t in all_tiles:
        cat = t['category']
        if cat not in by_cat:
            by_cat[cat] = []
        by_cat[cat].append(t)

    mappings = {}

    for cat, tiles in by_cat.items():
        n = len(tiles)
        # Arrange in a grid: ~10 tiles per row
        cols = min(10, n)
        rows = (n + cols - 1) // cols

        sheet_w = cols * tile_size
        sheet_h = rows * tile_size
        sheet = Image.new('RGBA', (sheet_w, sheet_h), (0, 0, 0, 0))

        cat_mapping = []
        for i, t in enumerate(tiles):
            orig_x = t['x'] * tile_size
            orig_y = t['y'] * tile_size
            tile_img = img.crop((orig_x, orig_y, orig_x + tile_size, orig_y + tile_size))

            sheet_col = i % cols
            sheet_row = i // cols
            sheet_x = sheet_col * tile_size
            sheet_y = sheet_row * tile_size
            sheet.paste(tile_img, (sheet_x, sheet_y))

            cat_mapping.append({
                'tile_id': t['id'],
                'orig_x': t['x'],
                'orig_y': t['y'],
                'sheet_x': sheet_col,
                'sheet_y': sheet_row
            })

        sheet_path = os.path.join(out_dir, f"{cat}.png")
        sheet.save(sheet_path)
        mappings[cat] = {
            'png': sheet_path,
            'cols': cols,
            'rows': rows,
            'tile_size': tile_size,
            'tiles': cat_mapping
        }
        print(f"  {cat}: {n} tiles -> {sheet_w}x{sheet_h} ({cols}x{rows} grid)")

    # Save mapping
    mapping_path = os.path.join(out_dir, 'extract_mapping.json')
    with open(mapping_path, 'w', encoding='utf-8') as f:
        json.dump(mappings, f, indent=2, ensure_ascii=False)
    print(f"\nMapping saved to: {mapping_path}")
    return mappings


def main():
    parser = argparse.ArgumentParser(description='Extract tiles by category from compiled tileset')
    parser.add_argument('--png', required=True, help='Path to compiled_tileset_32x32.png')
    parser.add_argument('--json', required=True, help='Path to compiled_tileset_32x32.json')
    parser.add_argument('--outdir', required=True, help='Output directory for grouped sheets')
    parser.add_argument('--categories', nargs='+', required=True, help='Categories to extract')
    parser.add_argument('--tile-size', type=int, default=32)
    args = parser.parse_args()

    print(f"Loading tileset JSON: {args.json}")
    tiles_data = load_tileset(args.json)
    print(f"Total tiles in JSON: {len(tiles_data.get('tiles', []))}")

    print(f"\nExtracting categories: {args.categories}")
    extract_and_group(args.png, tiles_data, args.categories, args.outdir, args.tile_size)
    print("\nDone!")


if __name__ == '__main__':
    main()
