"""
Analyze compiled_tileset_32x32.png and generate a Tiled-format tileset JSON
with automatic region classification.
"""
import json
from PIL import Image
from collections import defaultdict

PNG_PATH = r"D:\Users\viaco\tools\Toonflow-game\toonflow-game-plugins\workshops\toonflow-field-survival\resource_library\toonflow-field-survival\base\compiled_tileset_32x32\compiled_tileset_32x32.png"
OUTPUT_JSON = r"D:\Users\viaco\tools\Toonflow-game\toonflow-game-plugins\workshops\toonflow-field-survival\resource_library\toonflow-field-survival\base\compiled_tileset_32x32\compiled_tileset_32x32.json"

TILE_SIZE = 32
MARGIN = 0
SPACING = 0

def analyze_tile(img, col, row):
    """Analyze a single tile's pixel features."""
    x = col * TILE_SIZE
    y = row * TILE_SIZE
    tile = img.crop((x, y, x + TILE_SIZE, y + TILE_SIZE))
    
    # Convert to RGBA if not already
    if tile.mode != 'RGBA':
        tile = tile.convert('RGBA')
    
    pixels = list(tile.getdata())
    total = len(pixels)
    
    # Count transparent pixels
    transparent = sum(1 for p in pixels if p[3] < 10)
    transparent_ratio = transparent / total
    
    # Average color of non-transparent pixels
    opaque_pixels = [p for p in pixels if p[3] >= 10]
    if not opaque_pixels:
        return {
            'transparent_ratio': 1.0,
            'avg_r': 0, 'avg_g': 0, 'avg_b': 0,
            'dominant_hue': 'unknown',
            'is_empty': True
        }
    
    avg_r = sum(p[0] for p in opaque_pixels) / len(opaque_pixels)
    avg_g = sum(p[1] for p in opaque_pixels) / len(opaque_pixels)
    avg_b = sum(p[2] for p in opaque_pixels) / len(opaque_pixels)
    
    # Color variance (how "busy" the tile is)
    variance = 0
    if len(opaque_pixels) > 1:
        variance = sum(
            ((p[0]-avg_r)**2 + (p[1]-avg_g)**2 + (p[2]-avg_b)**2) / 3
            for p in opaque_pixels
        ) / len(opaque_pixels)
    
    # Simple hue classification
    max_c = max(avg_r, avg_g, avg_b)
    min_c = min(avg_r, avg_g, avg_b)
    diff = max_c - min_c
    
    if diff < 20:
        # Gray/neutral
        if avg_r < 60:
            hue = 'dark_gray'
        elif avg_r < 120:
            hue = 'mid_gray'
        else:
            hue = 'light_gray'
    elif avg_r == max_c and avg_g > avg_b:
        if avg_r > 180 and avg_g > 140:
            hue = 'warm_brown'  # dirt, wood
        else:
            hue = 'red_orange'
    elif avg_g == max_c:
        if avg_g > 100 and avg_r < 120:
            hue = 'green'  # grass, trees
        else:
            hue = 'yellow_green'
    elif avg_b == max_c:
        if avg_b > 120 and avg_r < 100:
            hue = 'blue'  # water
        else:
            hue = 'purple'
    else:
        hue = 'mixed'
    
    return {
        'transparent_ratio': round(transparent_ratio, 3),
        'avg_r': round(avg_r, 1),
        'avg_g': round(avg_g, 1),
        'avg_b': round(avg_b, 1),
        'variance': round(variance, 1),
        'dominant_hue': hue,
        'is_empty': transparent_ratio > 0.95
    }


def classify_tile(row, col, features, total_rows, total_cols):
    """Classify tile into categories based on position and features."""
    tr = features['transparent_ratio']
    avg_r = features['avg_r']
    avg_g = features['avg_g']
    avg_b = features['avg_b']
    hue = features['dominant_hue']
    
    # Empty / fully transparent
    if features['is_empty']:
        return 'empty'
    
    # Top rows: terrain (grass, water, paths)
    if row < 10:
        if hue == 'green':
            return 'terrain_grass'
        elif hue == 'blue':
            return 'terrain_water'
        elif hue == 'warm_brown' or hue == 'yellow_green':
            return 'terrain_ground'
        elif tr > 0.5:
            return 'terrain_edge'
        else:
            return 'terrain_other'
    
    # Rows 10-25: small decorations, props, items
    if row < 25:
        if tr > 0.3:
            return 'prop_small'  # small items with transparency
        elif hue == 'green':
            return 'plant_small'
        else:
            return 'decoration'
    
    # Rows 25-50: trees, larger props, building parts
    if row < 50:
        if hue == 'green':
            return 'tree_plant'
        elif tr > 0.2:
            return 'prop_large'
        else:
            return 'building_part'
    
    # Rows 50-80: buildings, walls, structures
    if row < 80:
        if tr > 0.5:
            return 'structure_edge'
        else:
            return 'building_wall'
    
    # Bottom rows: special tiles, doors, large structures
    return 'special_structure'


def main():
    print(f"Loading image: {PNG_PATH}")
    img = Image.open(PNG_PATH)
    width, height = img.size
    print(f"Image size: {width} x {height}")
    
    cols = width // TILE_SIZE
    rows = height // TILE_SIZE
    total_tiles = cols * rows
    print(f"Grid: {cols} cols x {rows} rows = {total_tiles} tiles")
    
    # Analyze each tile
    tiles_data = []
    category_counts = defaultdict(int)
    
    for row in range(rows):
        for col in range(cols):
            tile_id = row * cols + col
            features = analyze_tile(img, col, row)
            category = classify_tile(row, col, features, rows, cols)
            category_counts[category] += 1
            
            tiles_data.append({
                'id': tile_id,
                'x': col,
                'y': row,
                'pixel_x': col * TILE_SIZE,
                'pixel_y': row * TILE_SIZE,
                'category': category,
                'transparent_ratio': features['transparent_ratio'],
                'avg_color': f"#{int(features['avg_r']):02x}{int(features['avg_g']):02x}{int(features['avg_b']):02x}",
                'dominant_hue': features['dominant_hue'],
                'is_empty': features['is_empty']
            })
    
    # Build Tiled-format tileset JSON
    tileset = {
        "columns": cols,
        "image": "compiled_tileset_32x32.png",
        "imageheight": height,
        "imagewidth": width,
        "margin": MARGIN,
        "name": "CompiledTileset_32x32",
        "spacing": SPACING,
        "tilecount": total_tiles,
        "tileheight": TILE_SIZE,
        "tilewidth": TILE_SIZE,
        "type": "tileset",
        # Custom extension: region classification for batch generation
        "regions": {
            "description": "Auto-classified tile regions for batch style regeneration",
            "categories": dict(category_counts)
        },
        "tiles": []
    }
    
    # Add non-empty tiles with properties (like Tiled format)
    for t in tiles_data:
        if t['is_empty']:
            continue
        
        props = [
            {"name": "category", "type": "string", "value": t['category']},
            {"name": "grid_x", "type": "int", "value": t['x']},
            {"name": "grid_y", "type": "int", "value": t['y']},
            {"name": "avg_color", "type": "string", "value": t['avg_color']},
            {"name": "dominant_hue", "type": "string", "value": t['dominant_hue']},
        ]
        
        # Add blocked flag for building/structure tiles (heuristic)
        if t['category'] in ('building_wall', 'building_part', 'special_structure', 'structure_edge'):
            props.append({"name": "blocked", "type": "bool", "value": True})
        
        tileset['tiles'].append({
            "id": t['id'],
            "properties": props
        })
    
    # Write output
    print(f"\nWriting JSON to: {OUTPUT_JSON}")
    with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(tileset, f, indent=2, ensure_ascii=False)
    
    # Print summary
    print(f"\n=== Summary ===")
    print(f"Total tiles: {total_tiles}")
    print(f"Non-empty tiles in JSON: {len(tileset['tiles'])}")
    print(f"\nCategory distribution:")
    for cat, count in sorted(category_counts.items(), key=lambda x: -x[1]):
        print(f"  {cat}: {count} tiles ({count/total_tiles*100:.1f}%)")
    
    print(f"\nDone! JSON saved to: {OUTPUT_JSON}")


if __name__ == '__main__':
    main()
