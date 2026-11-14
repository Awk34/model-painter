# Google Stitch Design Artifacts Kit (`design-artifacts/`)

This folder packages the visual design references, typography, iconography, studio photography, UI screenshots, and design system specification extracted from both the official **Paint Warhammer / Citadel Colour** mobile app (`com.gamesworkshop.citadelpaint` v3.1.1 / iOS v4.0.1) and the **`model-painter`** web companion app.

## Contents

1. **[`DESIGN.md`](../DESIGN.md)** (also copied to [`./DESIGN.md`](./DESIGN.md))
   - Complete, Stitch-ready design system specification covering the *Citadel Studio Dark* theme (plus the original mobile app's Light Gallery tokens), surface & semantic hex tokens, `Anton` + `Bitter` typography scale, responsive desktop/mobile shell, and signature hobbyist components.
2. **`fonts/`**
   - `anton_regular.ttf` — Authentic APK uppercase display font (`Anton`).
   - `bitter_regular.otf`, `bitter_bold.otf`, `bitter_italic.otf`, `bitter_bold_italic.otf` — Authentic APK editorial/body font family (`Bitter`).
   - `typography-and-palette-specimen.png` — High-resolution (`1520×1060`) visual specimen sheet rendering all fonts, UI buttons/badges, Tone Pro gradient, and hex color tokens for image-based reference upload in Google Stitch.
3. **`icons/`**
   - `icon-sheet-reference.png` — Single-image contact sheet of all 46 APK vector icons & Warhammer Colour / Warhammer Pro crests on dark studio cards.
   - `svg/` — All 46 raw SVG vector icons converted from Android `VectorDrawable` XMLs (`ic_*.svg`).
   - `png/` — Transparent PNG renders of all 46 icons and brand crests (`128×128` UI icons, `512×512` crests).
4. **`photos/`**
   - `photo-reference-sheet.png` — Curated studio photography sheet combining Game Banners, Miniatures, Paint Pots, and Space Marine Colour Backpacks/Bases.
   - `games/` — 4 Game System banners (*Warhammer 40,000*, *Warhammer Age of Sigmar*, *The Horus Heresy*, *Kill Team*).
   - `miniatures/` — 6 studio miniature photos (*Abaddon the Despoiler*, *Commander Dante*, *Captain Titus*, *Trajann Valoris*, *Bannernob*, *Hive Fleet Leviathan Ripper Swarm*).
   - `paints/` — 7 Citadel Classic & Warhammer Pro paint pot renders (*Mephiston Red*, *Macragge Blue*, *Retributor Armour*, *Nuln Oil*, *Blood Angels Red*, and *Blackstone Void 1 & 2*).
   - `colours-and-bases/` — 6 Space Marine Backpack colour showcases (*Adeptus Custodes Armour*, *Aged Brass*, *Blue*, *Blood Red*) and Basing texture guides (*Arid Martian Soil*, *Toxic Swamp*).
5. **`screenshots/`**
   - **`model-painter/` (12 Desktop `1440×900` & Mobile `390×844` captures):**
     - `01-account-sync-desktop.png` — Account & Data Sync populated with the extracted snapshot (5 projects, 64 owned paints, 34 wishlist paints).
     - `02-hobby-desk-projects-desktop.png` — Hobby Desk dashboard with KPI pills and project cards (*Armageddon*, *Custodes*, *Dante*, *Starter set*, *TITUS*).
     - `03-project-detail-paint-readiness-desktop.png` — Project Detail (*Custodes*) Required & Missing Paints Rollup with Base/Detail/Artificer readiness gauges.
     - `04-project-detail-models-tab-desktop.png` — Project Detail (*Custodes*) Models tab.
     - `05-paint-detail-modal-equivalents-desktop.png` — Paint Detail Modal (*Bloodtoof Red 3*) showing paint pot render, Citadel Classic equivalents, and 3rd-party `ΔE` conversions.
     - `06-cross-brand-converter-controls-desktop.png` — Cross-Brand Converter search and brand filter controls.
     - `07-cross-brand-converter-results-desktop.png` — Cross-Brand Converter comparison cards (`Mephiston Red`, `Macragge Blue`, etc.) with `ΔE` badges.
     - `08-paint-a-model-catalogue-desktop.png` — Paint A Model catalogue with game banners and miniature recipe cards.
     - `09-model-recipe-detail-abaddon-desktop.png` — Model Recipe Detail (*Abaddon the Despoiler*) with 15 interactive `(x, y)` colour pins and readiness bars.
     - `10-colour-detail-custodes-armour-desktop.png` — Colour Detail (*Adeptus Custodes Armour*) with Space Marine Backpack showcase and Classic/Tone Pro steps.
     - `11-hobby-desk-mobile.png` — Mobile (`390×844`) Hobby Desk with 5-tab bottom navigation bar.
     - `12-model-recipe-detail-abaddon-mobile.png` — Mobile (`390×844`) Model Recipe Detail (*Abaddon the Despoiler*) with interactive pins and bottom nav.
   - **`original-app/` (13 official *Paint Warhammer / Citadel Colour* store screenshots & icons):**
     - `app-icon-play-store-512.png` — Official `512×512` Paint Warhammer app icon.
     - `01-original-app-ios-screen-1.jpg` .. `06-original-app-ios-screen-6.jpg` — High-resolution (`1206×2622`) iOS App Store screenshots showing Colour Guides (*Ultramarines Armour*), My Paints Inventory/Wishlist, Comparison Tool (*Troll Slayer Orange* vs. *Chotec Orange* Tone Pro), and Hobby Desk Projects.
     - `07-original-app-android-screen-1.png` .. `10-original-app-android-screen-4.png` — Official (`1080×1920`) Android Google Play screenshots.
     - `00-google-play-store-listing.png` & `00-apple-app-store-listing.png` — Full store listing captures for context.

## Recommended Upload Order for Google Stitch

1. Upload **`DESIGN.md`** to your Stitch project to initialize the design system tokens (`Anton` headlines, dark mode, `#EDB304` / `#FBBA00` primary seed color).
2. Attach **`fonts/typography-and-palette-specimen.png`**, **`icons/icon-sheet-reference.png`**, **`photos/photo-reference-sheet.png`**, and any screens from **`screenshots/model-painter/`** or **`screenshots/original-app/`** as image references when prompting Stitch to generate or iterate on screens.
