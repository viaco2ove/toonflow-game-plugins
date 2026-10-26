"""
Batch replace tiles by category using template textures.
Preserves original tile shapes (alpha channel) while replacing surface texture.
"""
import argparse
import json
import os
import random
from PIL import Image


def load_tileset(json_path):
    with open(json_path, 'r', encoding='utf-8') as f:
        return json.load(f)


def replace_tile_texture(original_tile, template_img, tile_size=32, offset_x=0, offset_y=0):
    """
    Replace tile texture while preserving original alpha channel.
    Copies pixels from template at offset position, but keeps original alpha.
    """
    orig = original_tile.convert('RGBA')
    templ = template_img  # Already converted at load time
    
    # Crop a 32x32 region from template at the given offset
    tw, th = templ.size
    sx = offset_x % (tw - tile_size)
    sy = offset_y % (th - tile_size)
    templ_crop = templ.crop((sx, sy, sx + tile_size, sy + tile_size))
    
    # Composite: use original alpha, template RGB
    result = Image.new('RGBA', (tile_size, tile_size), (0, 0, 0, 0))
    orig_pixels = orig.load()
    templ_pixels = templ_crop.load()
    result_pixels = result.load()
    
    for y in range(tile_size):
        for x in range(tile_size):
            r, g, b, a = orig_pixels[x, y]
            if a > 0:
                # Use template color, original alpha
                tr, tg, tb, _ = templ_pixels[x, y]
                result_pixels[x, y] = (tr, tg, tb, a)
            else:
                result_pixels[x, y] = (0, 0, 0, 0)
    
    return result


def main():
    parser = argparse.ArgumentParser(description='Batch replace tile textures using templates')
    parser.add_argument('--base-png', required=True, help='Original tileset PNG')
    parser.add_argument('--json', required=True, help='Tileset JSON')
    parser.add_argument('--templates-dir', required=True, help='Dir with template_grass.png, template_water.png, template_sidewalk.png')
    parser.add_argument('--out-png', required=True, help='Output PNG path')
    parser.add_argument('--tile-size', type=int, default=32)
    parser.add_argument('--seed', type=int, default=42, help='Random seed for variation')
    args = parser.parse_args()

    random.seed(args.seed)
    
    # Load templates (skip broken ones gracefully)
    template_files = {
        'terrain_grass': 'template_grass.png',
        'terrain_water': 'template_water.png',
        'terrain_ground': 'template_sidewalk.png',
        'terrain_edge': 'template_sidewalk.png',
        'terrain_other': 'template_sidewalk.png',
    }
    templates = {}
    for cat, fname in template_files.items():
        fpath = os.path.join(args.templates_dir, fname)
        try:
            img = Image.open(fpath)
            img.load()  # Force load to catch truncated files
            templates[cat] = img.convert('RGBA')
            print(f"  Loaded template: {fname} ({img.size})")
        except Exception as e:
            print(f"  WARNING: Could not load {fname}: {e}, skipping category {cat}")
    
    # Load tileset JSON
    tiles_data = load_tileset(args.json)
    
    # Build category -> tile list map
    category_tiles = {}
    for tile in tiles_data.get('tiles', []):
        props = {p['name']: p['value'] for p in tile.get('properties', [])}
        cat = props.get('category', '')
        if cat in templates:
            if cat not in category_tiles:
                category_tiles[cat] = []
            category_tiles[cat].append({
                'id': tile['id'],
                'x': props.get('grid_x', 0),
                'y': props.get('grid_y', 0)
            })
    
    print(f"Categories to replace: {list(category_tiles.keys())}")
    for cat, tiles in category_tiles.items():
        print(f"  {cat}: {len(tiles)} tiles")
    
    # Load base image
    base = Image.open(args.base_png).convert('RGBA')
    print(f"\nBase image: {base.size}")
    
    # Replace each category
    total_replaced = 0
    for cat, tiles in category_tiles.items():
        templ = templates[cat]
        tw, th = templ.size
        
        for t in tiles:
            x = t['x'] * args.tile_size
            y = t['y'] * args.tile_size
            
            # Extract original tile
            orig_tile = base.crop((x, y, x + args.tile_size, y + args.tile_size))
            
            # Random offset for variation
            offset_x = random.randint(0, max(0, tw - args.tile_size))
            offset_y = random.randint(0, max(0, th - args.tile_size))
            
            # Replace texture
            new_tile = replace_tile_texture(orig_tile, templ, args.tile_size, offset_x, offset_y)
            
            # Paste back
            base.paste(new_tile, (x, y), new_tile)
            total_replaced += 1
    
    # Save output
    os.makedirs(os.path.dirname(args.out_png), exist_ok=True)
    base.save(args.out_png)
    
    print(f"\nTotal tiles replaced: {total_replaced}")
    print(f"Output saved to: {args.out_png}")
    print(f"Output size: {base.size}")


if __name__ == '__main__':
    main()
