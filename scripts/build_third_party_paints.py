#!/usr/bin/env python3
"""
Builds the comprehensive multi-brand 3rd-party paint database and bidirectional
Citadel <-> 3rd-party compatibility matrix using curated conversion tables +
CIELAB perceptual color-distance (Delta-E) matching against all 487 extracted
Citadel paints (Warhammer Colour & Warhammer Pro).
"""

import json
import math
from pathlib import Path

RAW_PAINTS_JSON = Path("/home/antigravity/warhammer_extractor/data/export/json/paints.json")
OUT_DIR = Path("/home/antigravity/warhammer_extractor/data/export/json")

CURATED_THIRD_PARTY_PAINTS = [
    # THE ARMY PAINTER - WARPAINTS FANATIC & ORIGINAL
    {"id": "tp-ap-wp3001", "brand": "The Army Painter", "range": "Warpaints Fanatic", "code": "WP3001", "name": "Matt Black", "category": "base", "potStyle": "flat", "hex": "#1B1B1B", "curatedCitadelNames": ["Abaddon Black", "Chaos Black"]},
    {"id": "tp-ap-wp3002", "brand": "The Army Painter", "range": "Warpaints Fanatic", "code": "WP3002", "name": "Matt White", "category": "layer", "potStyle": "flat", "hex": "#FFFFFF", "curatedCitadelNames": ["White Scar", "Corax White"]},
    {"id": "tp-ap-wp3005", "brand": "The Army Painter", "range": "Warpaints Fanatic", "code": "WP3005", "name": "Uniform Grey", "category": "base", "potStyle": "flat", "hex": "#5E6568", "curatedCitadelNames": ["Mechanicus Standard Grey", "Dawnstone"]},
    {"id": "tp-ap-wp3006", "brand": "The Army Painter", "range": "Warpaints Fanatic", "code": "WP3006", "name": "Ash Grey", "category": "layer", "potStyle": "flat", "hex": "#A3A8AA", "curatedCitadelNames": ["Administratum Grey", "Grey Seer"]},
    {"id": "tp-ap-wp3010", "brand": "The Army Painter", "range": "Warpaints Fanatic", "code": "WP3010", "name": "Pure Red", "category": "layer", "potStyle": "flat", "hex": "#D11F26", "curatedCitadelNames": ["Evil Sunz Scarlet", "Wild Rider Red"]},
    {"id": "tp-ap-wp3011", "brand": "The Army Painter", "range": "Warpaints Fanatic", "code": "WP3011", "name": "Dragon Red", "category": "base", "potStyle": "flat", "hex": "#991E22", "curatedCitadelNames": ["Mephiston Red", "Khorne Red"]},
    {"id": "tp-ap-wp3012", "brand": "The Army Painter", "range": "Warpaints Fanatic", "code": "WP3012", "name": "Chaotic Red", "category": "base", "potStyle": "flat", "hex": "#6C1D24", "curatedCitadelNames": ["Khorne Red", "Flesh Tearers Red"]},
    {"id": "tp-ap-wp3015", "brand": "The Army Painter", "range": "Warpaints Fanatic", "code": "WP3015", "name": "Lava Orange", "category": "layer", "potStyle": "flat", "hex": "#E85425", "curatedCitadelNames": ["Troll Slayer Orange", "Fire Dragon Bright"]},
    {"id": "tp-ap-wp3020", "brand": "The Army Painter", "range": "Warpaints Fanatic", "code": "WP3020", "name": "Daemonic Yellow", "category": "layer", "potStyle": "flat", "hex": "#F9D616", "curatedCitadelNames": ["Flash Gitz Yellow", "Yriel Yellow"]},
    {"id": "tp-ap-wp3021", "brand": "The Army Painter", "range": "Warpaints Fanatic", "code": "WP3021", "name": "Desert Yellow", "category": "base", "potStyle": "flat", "hex": "#C89B2B", "curatedCitadelNames": ["Averland Sunset", "Zamesi Desert"]},
    {"id": "tp-ap-wp3025", "brand": "The Army Painter", "range": "Warpaints Fanatic", "code": "WP3025", "name": "Greenskin", "category": "base", "potStyle": "flat", "hex": "#2A6B2B", "curatedCitadelNames": ["Warpstone Glow", "Waaagh! Flesh"]},
    {"id": "tp-ap-wp3026", "brand": "The Army Painter", "range": "Warpaints Fanatic", "code": "WP3026", "name": "Goblin Green", "category": "layer", "potStyle": "flat", "hex": "#539B37", "curatedCitadelNames": ["Moot Green", "Warboss Green"]},
    {"id": "tp-ap-wp3027", "brand": "The Army Painter", "range": "Warpaints Fanatic", "code": "WP3027", "name": "Angel Green", "category": "base", "potStyle": "flat", "hex": "#164023", "curatedCitadelNames": ["Caliban Green", "Nocturne Green"]},
    {"id": "tp-ap-wp3028", "brand": "The Army Painter", "range": "Warpaints Fanatic", "code": "WP3028", "name": "Army Green", "category": "base", "potStyle": "flat", "hex": "#5A6A3E", "curatedCitadelNames": ["Death Guard Green", "Castellan Green"]},
    {"id": "tp-ap-wp3029", "brand": "The Army Painter", "range": "Warpaints Fanatic", "code": "WP3029", "name": "Necrotic Flesh", "category": "layer", "potStyle": "flat", "hex": "#9AB07A", "curatedCitadelNames": ["Nurgling Green", "Krieg Khaki"]},
    {"id": "tp-ap-wp3035", "brand": "The Army Painter", "range": "Warpaints Fanatic", "code": "WP3035", "name": "Ultramarine Blue", "category": "base", "potStyle": "flat", "hex": "#1C4987", "curatedCitadelNames": ["Macragge Blue", "Altdorf Guard Blue"]},
    {"id": "tp-ap-wp3036", "brand": "The Army Painter", "range": "Warpaints Fanatic", "code": "WP3036", "name": "Crystal Blue", "category": "layer", "potStyle": "flat", "hex": "#267CC2", "curatedCitadelNames": ["Calgar Blue", "Teclis Blue", "Lothern Blue"]},
    {"id": "tp-ap-wp3037", "brand": "The Army Painter", "range": "Warpaints Fanatic", "code": "WP3037", "name": "Deep Blue", "category": "base", "potStyle": "flat", "hex": "#122B54", "curatedCitadelNames": ["Kantor Blue", "Night Lords Blue"]},
    {"id": "tp-ap-wp3038", "brand": "The Army Painter", "range": "Warpaints Fanatic", "code": "WP3038", "name": "Wolf Grey", "category": "layer", "potStyle": "flat", "hex": "#6E8EA7", "curatedCitadelNames": ["Russ Grey", "Fenrisian Grey"]},
    {"id": "tp-ap-wp3039", "brand": "The Army Painter", "range": "Warpaints Fanatic", "code": "WP3039", "name": "Hydra Turquoise", "category": "base", "potStyle": "flat", "hex": "#156E75", "curatedCitadelNames": ["Sotek Green", "Thousand Sons Blue"]},
    {"id": "tp-ap-wp3045", "brand": "The Army Painter", "range": "Warpaints Fanatic", "code": "WP3045", "name": "Alien Purple", "category": "base", "potStyle": "flat", "hex": "#562B7A", "curatedCitadelNames": ["Naggaroth Night", "Xereus Purple"]},
    {"id": "tp-ap-wp3046", "brand": "The Army Painter", "range": "Warpaints Fanatic", "code": "WP3046", "name": "Warlock Purple", "category": "layer", "potStyle": "flat", "hex": "#9C2865", "curatedCitadelNames": ["Screamer Pink", "Emperor's Children"]},
    {"id": "tp-ap-wp3050", "brand": "The Army Painter", "range": "Warpaints Fanatic", "code": "WP3050", "name": "Skeleton Bone", "category": "layer", "potStyle": "flat", "hex": "#D4C29A", "curatedCitadelNames": ["Ushabti Bone", "Wraithbone"]},
    {"id": "tp-ap-wp3051", "brand": "The Army Painter", "range": "Warpaints Fanatic", "code": "WP3051", "name": "Mummy Robes", "category": "layer", "potStyle": "flat", "hex": "#EBE2CE", "curatedCitadelNames": ["Screaming Skull", "Pallid Wych Flesh"]},
    {"id": "tp-ap-wp3055", "brand": "The Army Painter", "range": "Warpaints Fanatic", "code": "WP3055", "name": "Leather Brown", "category": "base", "potStyle": "flat", "hex": "#6F432A", "curatedCitadelNames": ["Mournfang Brown", "Skrag Brown"]},
    {"id": "tp-ap-wp3056", "brand": "The Army Painter", "range": "Warpaints Fanatic", "code": "WP3056", "name": "Oak Brown", "category": "base", "potStyle": "flat", "hex": "#432719", "curatedCitadelNames": ["Rhinox Hide", "Dryad Bark"]},
    {"id": "tp-ap-wp3057", "brand": "The Army Painter", "range": "Warpaints Fanatic", "code": "WP3057", "name": "Monster Brown", "category": "base", "potStyle": "flat", "hex": "#855E3F", "curatedCitadelNames": ["Steel Legion Drab", "XV-88"]},
    {"id": "tp-ap-wp3060", "brand": "The Army Painter", "range": "Warpaints Fanatic", "code": "WP3060", "name": "Barbarian Flesh", "category": "base", "potStyle": "flat", "hex": "#C88465", "curatedCitadelNames": ["Bugman's Glow", "Cadian Fleshtone"]},
    {"id": "tp-ap-wp3061", "brand": "The Army Painter", "range": "Warpaints Fanatic", "code": "WP3061", "name": "Kobold Skin", "category": "layer", "potStyle": "flat", "hex": "#DFA88A", "curatedCitadelNames": ["Kislev Flesh", "Flayed One Flesh"]},
    {"id": "tp-ap-wp3070", "brand": "The Army Painter", "range": "Warpaints Fanatic Metallics", "code": "WP3070", "name": "Gun Metal", "category": "base", "potStyle": "metallic", "hex": "#6D7378", "curatedCitadelNames": ["Leadbelcher", "Iron Warriors"]},
    {"id": "tp-ap-wp3071", "brand": "The Army Painter", "range": "Warpaints Fanatic Metallics", "code": "WP3071", "name": "Plate Mail Metal", "category": "layer", "potStyle": "metallic", "hex": "#9BA1A6", "curatedCitadelNames": ["Ironbreaker", "Runefang Steel"]},
    {"id": "tp-ap-wp3072", "brand": "The Army Painter", "range": "Warpaints Fanatic Metallics", "code": "WP3072", "name": "Shining Silver", "category": "layer", "potStyle": "metallic", "hex": "#C2C7CC", "curatedCitadelNames": ["Stormhost Silver", "Runefang Steel"]},
    {"id": "tp-ap-wp3073", "brand": "The Army Painter", "range": "Warpaints Fanatic Metallics", "code": "WP3073", "name": "Greedy Gold", "category": "base", "potStyle": "metallic", "hex": "#C4912C", "curatedCitadelNames": ["Retributor Armour", "Gehenna's Gold"]},
    {"id": "tp-ap-wp3074", "brand": "The Army Painter", "range": "Warpaints Fanatic Metallics", "code": "WP3074", "name": "Bright Gold", "category": "layer", "potStyle": "metallic", "hex": "#DDB44B", "curatedCitadelNames": ["Auric Armour Gold", "Liberator Gold"]},
    {"id": "tp-ap-wp3075", "brand": "The Army Painter", "range": "Warpaints Fanatic Metallics", "code": "WP3075", "name": "Weapon Bronze", "category": "base", "potStyle": "metallic", "hex": "#8F572D", "curatedCitadelNames": ["Balthasar Gold", "Screaming Bell"]},
    {"id": "tp-ap-wp3076", "brand": "The Army Painter", "range": "Warpaints Fanatic Metallics", "code": "WP3076", "name": "True Copper", "category": "layer", "potStyle": "metallic", "hex": "#AD5B38", "curatedCitadelNames": ["Hashut Copper", "Brass Scorpion"]},
    {"id": "tp-ap-wp3080", "brand": "The Army Painter", "range": "Warpaints Fanatic Washes", "code": "WP3080", "name": "Dark Tone", "category": "shade", "potStyle": "shade", "hex": "#222220", "curatedCitadelNames": ["Nuln Oil"]},
    {"id": "tp-ap-wp3081", "brand": "The Army Painter", "range": "Warpaints Fanatic Washes", "code": "WP3081", "name": "Strong Tone", "category": "shade", "potStyle": "shade", "hex": "#423122", "curatedCitadelNames": ["Agrax Earthshade"]},
    {"id": "tp-ap-wp3082", "brand": "The Army Painter", "range": "Warpaints Fanatic Washes", "code": "WP3082", "name": "Soft Tone", "category": "shade", "potStyle": "shade", "hex": "#6E5233", "curatedCitadelNames": ["Seraphim Sepia"]},
    {"id": "tp-ap-wp3083", "brand": "The Army Painter", "range": "Warpaints Fanatic Washes", "code": "WP3083", "name": "Flesh Wash", "category": "shade", "potStyle": "shade", "hex": "#7E3E29", "curatedCitadelNames": ["Reikland Fleshshade"]},
    {"id": "tp-ap-wp3084", "brand": "The Army Painter", "range": "Warpaints Fanatic Washes", "code": "WP3084", "name": "Red Tone", "category": "shade", "potStyle": "shade", "hex": "#8B1F23", "curatedCitadelNames": ["Carroburg Crimson", "Berserker Bloodshade"]},
    {"id": "tp-ap-wp3085", "brand": "The Army Painter", "range": "Warpaints Fanatic Washes", "code": "WP3085", "name": "Blue Tone", "category": "shade", "potStyle": "shade", "hex": "#1B3F6B", "curatedCitadelNames": ["Drakenhof Nightshade", "Tyran Blue"]},
    {"id": "tp-ap-wp3086", "brand": "The Army Painter", "range": "Warpaints Fanatic Washes", "code": "WP3086", "name": "Green Tone", "category": "shade", "potStyle": "shade", "hex": "#254E2A", "curatedCitadelNames": ["Biel-Tan Green", "Athonian Camoshade"]},
    {"id": "tp-ap-wp3087", "brand": "The Army Painter", "range": "Warpaints Fanatic Washes", "code": "WP3087", "name": "Purple Tone", "category": "shade", "potStyle": "shade", "hex": "#4B2656", "curatedCitadelNames": ["Druchii Violet"]},

    # THE ARMY PAINTER - SPEEDPAINT 2.0 (CONTRAST EQUIVALENTS)
    {"id": "tp-ap-sp2001", "brand": "The Army Painter", "range": "Speedpaint 2.0", "code": "SP2001", "name": "Grim Black", "category": "contrast", "potStyle": "contrast", "hex": "#2A2C2E", "curatedCitadelNames": ["Black Templar", "Black Legion"]},
    {"id": "tp-ap-sp2002", "brand": "The Army Painter", "range": "Speedpaint 2.0", "code": "SP2002", "name": "Gravelord Grey", "category": "contrast", "potStyle": "contrast", "hex": "#54585A", "curatedCitadelNames": ["Basilicanum Grey"]},
    {"id": "tp-ap-sp2003", "brand": "The Army Painter", "range": "Speedpaint 2.0", "code": "SP2003", "name": "Pallid Bone", "category": "contrast", "potStyle": "contrast", "hex": "#C2A97A", "curatedCitadelNames": ["Skeleton Horde"]},
    {"id": "tp-ap-sp2004", "brand": "The Army Painter", "range": "Speedpaint 2.0", "code": "SP2004", "name": "Crusader Skin", "category": "contrast", "potStyle": "contrast", "hex": "#CF8A6D", "curatedCitadelNames": ["Guilliman Flesh", "Darkoath Flesh"]},
    {"id": "tp-ap-sp2005", "brand": "The Army Painter", "range": "Speedpaint 2.0", "code": "SP2005", "name": "Blood Red", "category": "contrast", "potStyle": "contrast", "hex": "#B51B22", "curatedCitadelNames": ["Blood Angels Red", "Baal Red"]},
    {"id": "tp-ap-sp2006", "brand": "The Army Painter", "range": "Speedpaint 2.0", "code": "SP2006", "name": "Slaughter Red", "category": "contrast", "potStyle": "contrast", "hex": "#7D161D", "curatedCitadelNames": ["Flesh Tearers Red"]},
    {"id": "tp-ap-sp2007", "brand": "The Army Painter", "range": "Speedpaint 2.0", "code": "SP2007", "name": "Fire Giant Orange", "category": "contrast", "potStyle": "contrast", "hex": "#E3581E", "curatedCitadelNames": ["Gryph-Hound Orange", "Magmadroth Flame"]},
    {"id": "tp-ap-sp2008", "brand": "The Army Painter", "range": "Speedpaint 2.0", "code": "SP2008", "name": "Zealot Yellow", "category": "contrast", "potStyle": "contrast", "hex": "#F1AE1D", "curatedCitadelNames": ["Iyanden Yellow", "Imperial Fist"]},
    {"id": "tp-ap-sp2009", "brand": "The Army Painter", "range": "Speedpaint 2.0", "code": "SP2009", "name": "Orc Skin", "category": "contrast", "potStyle": "contrast", "hex": "#3B8734", "curatedCitadelNames": ["Ork Flesh", "Mantis Warriors Green"]},
    {"id": "tp-ap-sp2010", "brand": "The Army Painter", "range": "Speedpaint 2.0", "code": "SP2010", "name": "Absolution Green", "category": "contrast", "potStyle": "contrast", "hex": "#18472A", "curatedCitadelNames": ["Dark Angels Green", "Creed Camo"]},
    {"id": "tp-ap-sp2011", "brand": "The Army Painter", "range": "Speedpaint 2.0", "code": "SP2011", "name": "Beowulf Blue", "category": "contrast", "potStyle": "contrast", "hex": "#1B4A82", "curatedCitadelNames": ["Ultramarines Blue", "Asurmen Blue"]},
    {"id": "tp-ap-sp2012", "brand": "The Army Painter", "range": "Speedpaint 2.0", "code": "SP2012", "name": "Highlord Blue", "category": "contrast", "potStyle": "contrast", "hex": "#1E6CB6", "curatedCitadelNames": ["Talassar Blue", "Celestium Blue"]},
    {"id": "tp-ap-sp2013", "brand": "The Army Painter", "range": "Speedpaint 2.0", "code": "SP2013", "name": "Purple Swarm", "category": "contrast", "potStyle": "contrast", "hex": "#5E2A7E", "curatedCitadelNames": ["Luxion Purple", "Shyish Purple"]},
    {"id": "tp-ap-sp2014", "brand": "The Army Painter", "range": "Speedpaint 2.0", "code": "SP2014", "name": "Hardened Leather", "category": "contrast", "potStyle": "contrast", "hex": "#6B3C21", "curatedCitadelNames": ["Snakebite Leather", "Gore-grunta Fur"]},
    {"id": "tp-ap-sp2015", "brand": "The Army Painter", "range": "Speedpaint 2.0", "code": "SP2015", "name": "Dark Wood", "category": "contrast", "potStyle": "contrast", "hex": "#452B1F", "curatedCitadelNames": ["Wyldwood", "Cygor Brown"]},

    # VALLEJO - GAME COLOR & MODEL COLOR
    {"id": "tp-val-72001", "brand": "Vallejo", "range": "Game Color", "code": "72.001", "name": "Dead White", "category": "layer", "potStyle": "flat", "hex": "#FFFFFF", "curatedCitadelNames": ["White Scar"]},
    {"id": "tp-val-72051", "brand": "Vallejo", "range": "Game Color", "code": "72.051", "name": "Black", "category": "base", "potStyle": "flat", "hex": "#171717", "curatedCitadelNames": ["Abaddon Black"]},
    {"id": "tp-val-72003", "brand": "Vallejo", "range": "Game Color", "code": "72.003", "name": "Pale Flesh", "category": "layer", "potStyle": "flat", "hex": "#EBC2AF", "curatedCitadelNames": ["Pallid Wych Flesh", "Flayed One Flesh"]},
    {"id": "tp-val-72004", "brand": "Vallejo", "range": "Game Color", "code": "72.004", "name": "Elf Skin Tone", "category": "layer", "potStyle": "flat", "hex": "#DF9D78", "curatedCitadelNames": ["Kislev Flesh", "Cadian Fleshtone"]},
    {"id": "tp-val-72006", "brand": "Vallejo", "range": "Game Color", "code": "72.006", "name": "Sun Yellow", "category": "layer", "potStyle": "flat", "hex": "#FCE016", "curatedCitadelNames": ["Flash Gitz Yellow", "Yriel Yellow"]},
    {"id": "tp-val-72007", "brand": "Vallejo", "range": "Game Color", "code": "72.007", "name": "Gold Yellow", "category": "base", "potStyle": "flat", "hex": "#F8B323", "curatedCitadelNames": ["Averland Sunset", "Yriel Yellow"]},
    {"id": "tp-val-72008", "brand": "Vallejo", "range": "Game Color", "code": "72.008", "name": "Orange Fire", "category": "layer", "potStyle": "flat", "hex": "#F15E22", "curatedCitadelNames": ["Troll Slayer Orange", "Fire Dragon Bright"]},
    {"id": "tp-val-72010", "brand": "Vallejo", "range": "Game Color", "code": "72.010", "name": "Bloody Red", "category": "layer", "potStyle": "flat", "hex": "#D42027", "curatedCitadelNames": ["Evil Sunz Scarlet", "Wild Rider Red"]},
    {"id": "tp-val-72011", "brand": "Vallejo", "range": "Game Color", "code": "72.011", "name": "Gory Red", "category": "base", "potStyle": "flat", "hex": "#8D1C21", "curatedCitadelNames": ["Mephiston Red", "Khorne Red"]},
    {"id": "tp-val-72012", "brand": "Vallejo", "range": "Game Color", "code": "72.012", "name": "Scarlet Red", "category": "base", "potStyle": "flat", "hex": "#721821", "curatedCitadelNames": ["Khorne Red", "Gal Vorbak Red"]},
    {"id": "tp-val-72014", "brand": "Vallejo", "range": "Game Color", "code": "72.014", "name": "Warlord Purple", "category": "base", "potStyle": "flat", "hex": "#8A1E56", "curatedCitadelNames": ["Screamer Pink", "Barak-Nar Burgundy"]},
    {"id": "tp-val-72016", "brand": "Vallejo", "range": "Game Color", "code": "72.016", "name": "Royal Purple", "category": "base", "potStyle": "flat", "hex": "#4A266A", "curatedCitadelNames": ["Xereus Purple", "Naggaroth Night"]},
    {"id": "tp-val-72019", "brand": "Vallejo", "range": "Game Color", "code": "72.019", "name": "Night Blue", "category": "base", "potStyle": "flat", "hex": "#16264C", "curatedCitadelNames": ["Kantor Blue", "Night Lords Blue"]},
    {"id": "tp-val-72020", "brand": "Vallejo", "range": "Game Color", "code": "72.020", "name": "Imperial Blue", "category": "base", "potStyle": "flat", "hex": "#1B3F7B", "curatedCitadelNames": ["Macragge Blue"]},
    {"id": "tp-val-72021", "brand": "Vallejo", "range": "Game Color", "code": "72.021", "name": "Magic Blue", "category": "layer", "potStyle": "flat", "hex": "#1D69B4", "curatedCitadelNames": ["Altdorf Guard Blue", "Calgar Blue"]},
    {"id": "tp-val-72023", "brand": "Vallejo", "range": "Game Color", "code": "72.023", "name": "Electric Blue", "category": "layer", "potStyle": "flat", "hex": "#3598D4", "curatedCitadelNames": ["Lothern Blue", "Baharroth Blue"]},
    {"id": "tp-val-72024", "brand": "Vallejo", "range": "Game Color", "code": "72.024", "name": "Turquoise", "category": "base", "potStyle": "flat", "hex": "#116C78", "curatedCitadelNames": ["Sotek Green", "Ahriman Blue"]},
    {"id": "tp-val-72028", "brand": "Vallejo", "range": "Game Color", "code": "72.028", "name": "Dark Green", "category": "base", "potStyle": "flat", "hex": "#134224", "curatedCitadelNames": ["Caliban Green"]},
    {"id": "tp-val-72029", "brand": "Vallejo", "range": "Game Color", "code": "72.029", "name": "Sick Green", "category": "base", "potStyle": "flat", "hex": "#286F32", "curatedCitadelNames": ["Warpstone Glow"]},
    {"id": "tp-val-72030", "brand": "Vallejo", "range": "Game Color", "code": "72.030", "name": "Goblin Green", "category": "layer", "potStyle": "flat", "hex": "#4E9A36", "curatedCitadelNames": ["Warboss Green", "Moot Green"]},
    {"id": "tp-val-72032", "brand": "Vallejo", "range": "Game Color", "code": "72.032", "name": "Scorpy Green", "category": "layer", "potStyle": "flat", "hex": "#6BC048", "curatedCitadelNames": ["Moot Green"]},
    {"id": "tp-val-72034", "brand": "Vallejo", "range": "Game Color", "code": "72.034", "name": "Bonewhite", "category": "layer", "potStyle": "flat", "hex": "#D8C89E", "curatedCitadelNames": ["Ushabti Bone", "Screaming Skull"]},
    {"id": "tp-val-72036", "brand": "Vallejo", "range": "Game Color", "code": "72.036", "name": "Bronze Flesh", "category": "base", "potStyle": "flat", "hex": "#C68356", "curatedCitadelNames": ["Ratskin Flesh", "Cadian Fleshtone"]},
    {"id": "tp-val-72040", "brand": "Vallejo", "range": "Game Color", "code": "72.040", "name": "Leather Brown", "category": "base", "potStyle": "flat", "hex": "#6F4329", "curatedCitadelNames": ["Mournfang Brown"]},
    {"id": "tp-val-72043", "brand": "Vallejo", "range": "Game Color", "code": "72.043", "name": "Beasty Brown", "category": "base", "potStyle": "flat", "hex": "#5C3A24", "curatedCitadelNames": ["Mournfang Brown", "XV-88"]},
    {"id": "tp-val-72045", "brand": "Vallejo", "range": "Game Color", "code": "72.045", "name": "Charred Brown", "category": "base", "potStyle": "flat", "hex": "#3E261E", "curatedCitadelNames": ["Rhinox Hide", "Dryad Bark"]},
    {"id": "tp-val-72049", "brand": "Vallejo", "range": "Game Color", "code": "72.049", "name": "Stonewall Grey", "category": "layer", "potStyle": "flat", "hex": "#9CA1A4", "curatedCitadelNames": ["Administratum Grey", "Grey Seer"]},
    {"id": "tp-val-72050", "brand": "Vallejo", "range": "Game Color", "code": "72.050", "name": "Cold Grey", "category": "base", "potStyle": "flat", "hex": "#62686C", "curatedCitadelNames": ["Mechanicus Standard Grey", "Dawnstone"]},
    {"id": "tp-val-72052", "brand": "Vallejo", "range": "Game Color", "code": "72.052", "name": "Silver", "category": "layer", "potStyle": "metallic", "hex": "#C0C6CA", "curatedCitadelNames": ["Runefang Steel", "Stormhost Silver"]},
    {"id": "tp-val-72053", "brand": "Vallejo", "range": "Game Color", "code": "72.053", "name": "Chainmail Silver", "category": "layer", "potStyle": "metallic", "hex": "#959B9F", "curatedCitadelNames": ["Ironbreaker"]},
    {"id": "tp-val-72054", "brand": "Vallejo", "range": "Game Color", "code": "72.054", "name": "Gunmetal", "category": "base", "potStyle": "metallic", "hex": "#686E73", "curatedCitadelNames": ["Leadbelcher"]},
    {"id": "tp-val-72055", "brand": "Vallejo", "range": "Game Color", "code": "72.055", "name": "Polished Gold", "category": "layer", "potStyle": "metallic", "hex": "#DFB64C", "curatedCitadelNames": ["Auric Armour Gold", "Liberator Gold"]},
    {"id": "tp-val-72056", "brand": "Vallejo", "range": "Game Color", "code": "72.056", "name": "Glorious Gold", "category": "base", "potStyle": "metallic", "hex": "#C28E2B", "curatedCitadelNames": ["Retributor Armour", "Gehenna's Gold"]},
    {"id": "tp-val-72057", "brand": "Vallejo", "range": "Game Color", "code": "72.057", "name": "Bright Bronze", "category": "layer", "potStyle": "metallic", "hex": "#AA6238", "curatedCitadelNames": ["Hashut Copper", "Brass Scorpion"]},
    {"id": "tp-val-72058", "brand": "Vallejo", "range": "Game Color", "code": "72.058", "name": "Brassy Brass", "category": "base", "potStyle": "metallic", "hex": "#8B542D", "curatedCitadelNames": ["Balthasar Gold", "Runelord Brass"]},
    {"id": "tp-val-73201", "brand": "Vallejo", "range": "Game Wash", "code": "73.201", "name": "Black Wash", "category": "shade", "potStyle": "shade", "hex": "#212121", "curatedCitadelNames": ["Nuln Oil"]},
    {"id": "tp-val-73200", "brand": "Vallejo", "range": "Game Wash", "code": "73.200", "name": "Sepia Wash", "category": "shade", "potStyle": "shade", "hex": "#6B4E2E", "curatedCitadelNames": ["Seraphim Sepia"]},
    {"id": "tp-val-73203", "brand": "Vallejo", "range": "Game Wash", "code": "73.203", "name": "Umber Wash", "category": "shade", "potStyle": "shade", "hex": "#433121", "curatedCitadelNames": ["Agrax Earthshade"]},
    {"id": "tp-val-73204", "brand": "Vallejo", "range": "Game Wash", "code": "73.204", "name": "Flesh Wash", "category": "shade", "potStyle": "shade", "hex": "#7D3F2A", "curatedCitadelNames": ["Reikland Fleshshade"]},
    {"id": "tp-val-70950", "brand": "Vallejo", "range": "Model Color", "code": "70.950", "name": "Black", "category": "base", "potStyle": "flat", "hex": "#181818", "curatedCitadelNames": ["Abaddon Black"]},
    {"id": "tp-val-70951", "brand": "Vallejo", "range": "Model Color", "code": "70.951", "name": "White", "category": "layer", "potStyle": "flat", "hex": "#FFFFFF", "curatedCitadelNames": ["White Scar"]},
    {"id": "tp-val-70909", "brand": "Vallejo", "range": "Model Color", "code": "70.909", "name": "Vermilion", "category": "layer", "potStyle": "flat", "hex": "#D2232A", "curatedCitadelNames": ["Evil Sunz Scarlet"]},
    {"id": "tp-val-70926", "brand": "Vallejo", "range": "Model Color", "code": "70.926", "name": "Red", "category": "base", "potStyle": "flat", "hex": "#951F24", "curatedCitadelNames": ["Mephiston Red"]},
    {"id": "tp-val-70880", "brand": "Vallejo", "range": "Model Color", "code": "70.880", "name": "Khaki Grey", "category": "base", "potStyle": "flat", "hex": "#8B7D5B", "curatedCitadelNames": ["Zandri Dust", "Steel Legion Drab"]},

    # TWO THIN COATS
    {"id": "tp-ttc-001", "brand": "Two Thin Coats", "range": "Core Range", "code": "TTC-001", "name": "Death Reaper", "category": "base", "potStyle": "flat", "hex": "#1A1A1A", "curatedCitadelNames": ["Abaddon Black"]},
    {"id": "tp-ttc-002", "brand": "Two Thin Coats", "range": "Core Range", "code": "TTC-002", "name": "Dungeon Stone", "category": "base", "potStyle": "flat", "hex": "#5E6468", "curatedCitadelNames": ["Mechanicus Standard Grey", "Eshin Grey"]},
    {"id": "tp-ttc-003", "brand": "Two Thin Coats", "range": "Core Range", "code": "TTC-003", "name": "Wizard Grey", "category": "layer", "potStyle": "flat", "hex": "#82888C", "curatedCitadelNames": ["Dawnstone"]},
    {"id": "tp-ttc-004", "brand": "Two Thin Coats", "range": "Core Range", "code": "TTC-004", "name": "Carcharodon Grey", "category": "layer", "potStyle": "flat", "hex": "#A6ACAF", "curatedCitadelNames": ["Administratum Grey", "Ulthuan Grey"]},
    {"id": "tp-ttc-005", "brand": "Two Thin Coats", "range": "Core Range", "code": "TTC-005", "name": "White Star", "category": "layer", "potStyle": "flat", "hex": "#FFFFFF", "curatedCitadelNames": ["White Scar"]},
    {"id": "tp-ttc-006", "brand": "Two Thin Coats", "range": "Core Range", "code": "TTC-006", "name": "Sanguine Scarlet", "category": "base", "potStyle": "flat", "hex": "#72161D", "curatedCitadelNames": ["Khorne Red"]},
    {"id": "tp-ttc-007", "brand": "Two Thin Coats", "range": "Core Range", "code": "TTC-007", "name": "Demon Red", "category": "base", "potStyle": "flat", "hex": "#9B1D22", "curatedCitadelNames": ["Mephiston Red"]},
    {"id": "tp-ttc-008", "brand": "Two Thin Coats", "range": "Core Range", "code": "TTC-008", "name": "Hellspawn Red", "category": "layer", "potStyle": "flat", "hex": "#D22328", "curatedCitadelNames": ["Evil Sunz Scarlet"]},
    {"id": "tp-ttc-009", "brand": "Two Thin Coats", "range": "Core Range", "code": "TTC-009", "name": "Fanatic Orange", "category": "layer", "potStyle": "flat", "hex": "#E85524", "curatedCitadelNames": ["Troll Slayer Orange", "Wild Rider Red"]},
    {"id": "tp-ttc-010", "brand": "Two Thin Coats", "range": "Core Range", "code": "TTC-010", "name": "Skulker Yellow", "category": "base", "potStyle": "flat", "hex": "#E2A51F", "curatedCitadelNames": ["Averland Sunset"]},
    {"id": "tp-ttc-011", "brand": "Two Thin Coats", "range": "Core Range", "code": "TTC-011", "name": "Yellow Flame", "category": "layer", "potStyle": "flat", "hex": "#F8CE1A", "curatedCitadelNames": ["Yriel Yellow", "Flash Gitz Yellow"]},
    {"id": "tp-ttc-012", "brand": "Two Thin Coats", "range": "Core Range", "code": "TTC-012", "name": "Wyvern Green", "category": "base", "potStyle": "flat", "hex": "#144123", "curatedCitadelNames": ["Caliban Green"]},
    {"id": "tp-ttc-013", "brand": "Two Thin Coats", "range": "Core Range", "code": "TTC-013", "name": "Emerald Green", "category": "layer", "potStyle": "flat", "hex": "#287233", "curatedCitadelNames": ["Warpstone Glow"]},
    {"id": "tp-ttc-014", "brand": "Two Thin Coats", "range": "Core Range", "code": "TTC-014", "name": "Ethereal Green", "category": "layer", "potStyle": "flat", "hex": "#62B644", "curatedCitadelNames": ["Moot Green"]},
    {"id": "tp-ttc-015", "brand": "Two Thin Coats", "range": "Core Range", "code": "TTC-015", "name": "Marine Blue", "category": "base", "potStyle": "flat", "hex": "#1B4684", "curatedCitadelNames": ["Macragge Blue"]},
    {"id": "tp-ttc-016", "brand": "Two Thin Coats", "range": "Core Range", "code": "TTC-016", "name": "Relic Blue", "category": "layer", "potStyle": "flat", "hex": "#246DB4", "curatedCitadelNames": ["Altdorf Guard Blue", "Calgar Blue"]},
    {"id": "tp-ttc-017", "brand": "Two Thin Coats", "range": "Core Range", "code": "TTC-017", "name": "Celestial Blue", "category": "layer", "potStyle": "flat", "hex": "#4D92CE", "curatedCitadelNames": ["Calgar Blue", "Lothern Blue"]},
    {"id": "tp-ttc-018", "brand": "Two Thin Coats", "range": "Core Range", "code": "TTC-018", "name": "Dragon's Gold", "category": "base", "potStyle": "metallic", "hex": "#C4912E", "curatedCitadelNames": ["Retributor Armour"]},
    {"id": "tp-ttc-019", "brand": "Two Thin Coats", "range": "Core Range", "code": "TTC-019", "name": "Glistening Gold", "category": "layer", "potStyle": "metallic", "hex": "#DFB64E", "curatedCitadelNames": ["Liberator Gold", "Auric Armour Gold"]},
    {"id": "tp-ttc-020", "brand": "Two Thin Coats", "range": "Core Range", "code": "TTC-020", "name": "Sir Coates Silver", "category": "base", "potStyle": "metallic", "hex": "#6D7378", "curatedCitadelNames": ["Leadbelcher"]},
    {"id": "tp-ttc-021", "brand": "Two Thin Coats", "range": "Core Range", "code": "TTC-021", "name": "Mythril Blade", "category": "layer", "potStyle": "metallic", "hex": "#C0C6CC", "curatedCitadelNames": ["Stormhost Silver", "Runefang Steel"]},
    {"id": "tp-ttc-022", "brand": "Two Thin Coats", "range": "Core Range", "code": "TTC-022", "name": "Oblivion Black Wash", "category": "shade", "potStyle": "shade", "hex": "#202020", "curatedCitadelNames": ["Nuln Oil"]},
    {"id": "tp-ttc-023", "brand": "Two Thin Coats", "range": "Core Range", "code": "TTC-023", "name": "Battle Mud Wash", "category": "shade", "potStyle": "shade", "hex": "#423020", "curatedCitadelNames": ["Agrax Earthshade"]},
    {"id": "tp-ttc-024", "brand": "Two Thin Coats", "range": "Core Range", "code": "TTC-024", "name": "Flesh Wash", "category": "shade", "potStyle": "shade", "hex": "#7D3E29", "curatedCitadelNames": ["Reikland Fleshshade"]},

    # MONUMENT HOBBIES - PRO ACRYL
    {"id": "tp-pa-001", "brand": "Monument Hobbies", "range": "Pro Acryl", "code": "PA-001", "name": "Bold Titanium White", "category": "layer", "potStyle": "flat", "hex": "#FFFFFF", "curatedCitadelNames": ["White Scar", "Corax White"]},
    {"id": "tp-pa-002", "brand": "Monument Hobbies", "range": "Pro Acryl", "code": "PA-002", "name": "Coal Black", "category": "base", "potStyle": "flat", "hex": "#181818", "curatedCitadelNames": ["Abaddon Black", "Corvus Black"]},
    {"id": "tp-pa-003", "brand": "Monument Hobbies", "range": "Pro Acryl", "code": "PA-003", "name": "Bold Pyrrole Red", "category": "layer", "potStyle": "flat", "hex": "#D81E25", "curatedCitadelNames": ["Evil Sunz Scarlet", "Mephiston Red"]},
    {"id": "tp-pa-004", "brand": "Monument Hobbies", "range": "Pro Acryl", "code": "PA-004", "name": "Burnt Red", "category": "base", "potStyle": "flat", "hex": "#7D1A21", "curatedCitadelNames": ["Khorne Red", "Word Bearers Red"]},
    {"id": "tp-pa-005", "brand": "Monument Hobbies", "range": "Pro Acryl", "code": "PA-005", "name": "Golden Yellow", "category": "base", "potStyle": "flat", "hex": "#F4B71E", "curatedCitadelNames": ["Averland Sunset", "Yriel Yellow"]},
    {"id": "tp-pa-006", "brand": "Monument Hobbies", "range": "Pro Acryl", "code": "PA-006", "name": "Green", "category": "base", "potStyle": "flat", "hex": "#246B31", "curatedCitadelNames": ["Warpstone Glow", "Caliban Green"]},
    {"id": "tp-pa-007", "brand": "Monument Hobbies", "range": "Pro Acryl", "code": "PA-007", "name": "Blue", "category": "base", "potStyle": "flat", "hex": "#1A4A88", "curatedCitadelNames": ["Macragge Blue", "Kantor Blue"]},
    {"id": "tp-pa-008", "brand": "Monument Hobbies", "range": "Pro Acryl", "code": "PA-008", "name": "Bright Ivory", "category": "layer", "potStyle": "flat", "hex": "#EBE2CC", "curatedCitadelNames": ["Screaming Skull", "Wraithbone"]},
    {"id": "tp-pa-009", "brand": "Monument Hobbies", "range": "Pro Acryl", "code": "PA-009", "name": "Dark Silver", "category": "base", "potStyle": "metallic", "hex": "#696F74", "curatedCitadelNames": ["Leadbelcher"]},
    {"id": "tp-pa-010", "brand": "Monument Hobbies", "range": "Pro Acryl", "code": "PA-010", "name": "Rich Gold", "category": "base", "potStyle": "metallic", "hex": "#C4902C", "curatedCitadelNames": ["Retributor Armour"]},

    # AK INTERACTIVE - 3RD GENERATION ACRYLICS
    {"id": "tp-ak-11001", "brand": "AK Interactive", "range": "3rd Gen Acrylics", "code": "AK11001", "name": "White", "category": "layer", "potStyle": "flat", "hex": "#FFFFFF", "curatedCitadelNames": ["White Scar"]},
    {"id": "tp-ak-11029", "brand": "AK Interactive", "range": "3rd Gen Acrylics", "code": "AK11029", "name": "Black", "category": "base", "potStyle": "flat", "hex": "#181818", "curatedCitadelNames": ["Abaddon Black"]},
    {"id": "tp-ak-11086", "brand": "AK Interactive", "range": "3rd Gen Acrylics", "code": "AK11086", "name": "Blood Red", "category": "base", "potStyle": "flat", "hex": "#9C1E23", "curatedCitadelNames": ["Mephiston Red"]},
    {"id": "tp-ak-11088", "brand": "AK Interactive", "range": "3rd Gen Acrylics", "code": "AK11088", "name": "Deep Red", "category": "base", "potStyle": "flat", "hex": "#741820", "curatedCitadelNames": ["Khorne Red"]},
    {"id": "tp-ak-11177", "brand": "AK Interactive", "range": "3rd Gen Acrylics", "code": "AK11177", "name": "Ducal Blue", "category": "base", "potStyle": "flat", "hex": "#1D4986", "curatedCitadelNames": ["Macragge Blue"]},
    {"id": "tp-ak-11142", "brand": "AK Interactive", "range": "3rd Gen Acrylics", "code": "AK11142", "name": "Deep Green", "category": "base", "potStyle": "flat", "hex": "#164324", "curatedCitadelNames": ["Caliban Green"]},
    {"id": "tp-ak-11212", "brand": "AK Interactive", "range": "3rd Gen Acrylics", "code": "AK11212", "name": "Gun Metal", "category": "base", "potStyle": "metallic", "hex": "#6C7277", "curatedCitadelNames": ["Leadbelcher"]},
    {"id": "tp-ak-11191", "brand": "AK Interactive", "range": "3rd Gen Acrylics", "code": "AK11191", "name": "Old Gold", "category": "base", "potStyle": "metallic", "hex": "#C28F2C", "curatedCitadelNames": ["Retributor Armour"]},
]


def hex_to_lab(hex_str: str):
    h = (hex_str or "#808080").lstrip("#")
    if len(h) != 6:
        h = "808080"
    r, g, b = int(h[0:2], 16) / 255.0, int(h[2:4], 16) / 255.0, int(h[4:6], 16) / 255.0

    def pivot_rgb(c):
        return ((c + 0.055) / 1.055) ** 2.4 if c > 0.04045 else c / 12.92

    r_l, g_l, b_l = pivot_rgb(r), pivot_rgb(g), pivot_rgb(b)
    x = (r_l * 0.4124 + g_l * 0.3576 + b_l * 0.1805) / 0.95047
    y = (r_l * 0.2126 + g_l * 0.7152 + b_l * 0.0722) / 1.00000
    z = (r_l * 0.0193 + g_l * 0.1192 + b_l * 0.9505) / 1.08883

    def pivot_xyz(t):
        return t ** (1.0 / 3.0) if t > 0.008856 else (7.787 * t) + (16.0 / 116.0)

    fx, fy, fz = pivot_xyz(x), pivot_xyz(y), pivot_xyz(z)
    L = (116.0 * fy) - 16.0
    a = 500.0 * (fx - fy)
    b_val = 200.0 * (fy - fz)
    return (L, a, b_val)


def delta_e_cie76(lab1, lab2) -> float:
    return math.sqrt((lab1[0] - lab2[0]) ** 2 + (lab1[1] - lab2[1]) ** 2 + (lab1[2] - lab2[2]) ** 2)


def is_finish_compatible(citadel_paint: dict, tp_paint: dict) -> bool:
    c_pot = citadel_paint.get("potStyle", "flat")
    c_cat = citadel_paint.get("category", "base")
    tp_pot = tp_paint.get("potStyle", "flat")
    tp_cat = tp_paint.get("category", "base")

    if tp_pot == "metallic" or c_pot == "metallic":
        return tp_pot == "metallic" and c_pot == "metallic"
    if tp_cat == "shade" or c_cat == "shade":
        return tp_cat == "shade" and c_cat == "shade"
    if tp_cat == "contrast" or c_cat == "contrast":
        return tp_cat == "contrast" and c_cat == "contrast"
    return True


def main():
    citadel_paints = json.loads(RAW_PAINTS_JSON.read_text(encoding="utf-8"))
    for cp in citadel_paints:
        c_hex = cp.get("gradientStartHex") or cp.get("hex") or "#808080"
        cp["_hex"] = c_hex
        cp["_lab"] = hex_to_lab(c_hex)

    name_to_citadel = {}
    for cp in citadel_paints:
        name_to_citadel.setdefault(cp["name"].strip().lower(), []).append(cp)

    citadel_to_tp_matches = {cp["id"]: [] for cp in citadel_paints}
    enriched_tp_paints = []

    for tp in CURATED_THIRD_PARTY_PAINTS:
        tp_lab = hex_to_lab(tp["hex"])
        matches = []
        seen_citadel_ids = set()

        for cname in tp.get("curatedCitadelNames", []):
            for cp in name_to_citadel.get(cname.strip().lower(), []):
                de = round(delta_e_cie76(tp_lab, cp["_lab"]), 2)
                matches.append({
                    "citadelPaintId": cp["id"],
                    "citadelPaintName": cp["name"],
                    "citadelRange": cp["range"],
                    "citadelCategory": cp["category"],
                    "citadelHex": cp["_hex"],
                    "matchType": "curated",
                    "deltaE": de,
                })
                seen_citadel_ids.add(cp["id"])
                citadel_to_tp_matches[cp["id"]].append({
                    "thirdPartyPaintId": tp["id"],
                    "brand": tp["brand"],
                    "range": tp["range"],
                    "code": tp["code"],
                    "name": tp["name"],
                    "hex": tp["hex"],
                    "matchType": "curated",
                    "deltaE": de,
                })

        scored = []
        for cp in citadel_paints:
            if cp["id"] in seen_citadel_ids:
                continue
            if not is_finish_compatible(cp, tp):
                continue
            de = round(delta_e_cie76(tp_lab, cp["_lab"]), 2)
            if de <= 16.0:
                scored.append((de, cp))
        scored.sort(key=lambda x: x[0])

        for de, cp in scored[:5]:
            matches.append({
                "citadelPaintId": cp["id"],
                "citadelPaintName": cp["name"],
                "citadelRange": cp["range"],
                "citadelCategory": cp["category"],
                "citadelHex": cp["_hex"],
                "matchType": "color_match",
                "deltaE": de,
            })
            citadel_to_tp_matches[cp["id"]].append({
                "thirdPartyPaintId": tp["id"],
                "brand": tp["brand"],
                "range": tp["range"],
                "code": tp["code"],
                "name": tp["name"],
                "hex": tp["hex"],
                "matchType": "color_match",
                "deltaE": de,
            })

        enriched_tp_paints.append({
            "id": tp["id"],
            "brand": tp["brand"],
            "range": tp["range"],
            "code": tp["code"],
            "name": tp["name"],
            "category": tp["category"],
            "potStyle": tp["potStyle"],
            "hex": tp["hex"],
            "citadelMatches": matches,
        })

    tp_with_lab = [(tp, hex_to_lab(tp["hex"])) for tp in enriched_tp_paints]
    for cp in citadel_paints:
        existing_tp_ids = {m["thirdPartyPaintId"] for m in citadel_to_tp_matches[cp["id"]]}
        if len(existing_tp_ids) < 3:
            candidates = []
            for tp, tp_lab in tp_with_lab:
                if tp["id"] in existing_tp_ids:
                    continue
                if not is_finish_compatible(cp, tp):
                    continue
                de = round(delta_e_cie76(cp["_lab"], tp_lab), 2)
                candidates.append((de, tp))
            candidates.sort(key=lambda x: x[0])
            for de, tp in candidates[: (3 - len(existing_tp_ids))]:
                citadel_to_tp_matches[cp["id"]].append({
                    "thirdPartyPaintId": tp["id"],
                    "brand": tp["brand"],
                    "range": tp["range"],
                    "code": tp["code"],
                    "name": tp["name"],
                    "hex": tp["hex"],
                    "matchType": "color_match",
                    "deltaE": de,
                })

        citadel_to_tp_matches[cp["id"]].sort(
            key=lambda m: (0 if m["matchType"] == "curated" else 1, m["deltaE"])
        )

    out_payload = {
        "thirdPartyPaints": enriched_tp_paints,
        "citadelToThirdPartyMap": citadel_to_tp_matches,
    }
    out_file = OUT_DIR / "third_party_paints.json"
    out_file.write_text(json.dumps(out_payload, indent=2), encoding="utf-8")
    print(
        f"[DONE] Wrote {len(enriched_tp_paints)} 3rd-party paints across 5 brands and mapped all {len(citadel_to_tp_matches)} Citadel paints -> {out_file}"
    )


if __name__ == "__main__":
    main()
