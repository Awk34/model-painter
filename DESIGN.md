# DESIGN.md — Paint Warhammer / Citadel Colour Companion (`model-painter`)

## 1. Brand & Aesthetic Direction
**Theme:** *Citadel Studio Dark* — a focused, high-contrast hobbyist workbench aesthetic derived from the official **Paint Warhammer / Citadel Colour** (`com.gamesworkshop.citadelpaint` v3.1.1) Android app and expanded for responsive web workflows.

- **Mood:** Tactical, editorial, colour-accurate, and craft-focused. Dark neutral slate surfaces keep the eye calibrated so miniature photography, metallic pigments, and paint swatches remain true-to-life without colour cast.
- **Dual Identity:** Bridges **Warhammer Colour** (signature warm Citadel Gold `#EDB304` / `#FBBA00`) with **Warhammer Pro / Tone Pro** (prismatic cyan-purple-gold brush-stroke accent) and multi-brand hobbyist utility.
- **Target Platforms:** Responsive Desktop (`>= 860px` persistent left rail + split studio stages) and Mobile (`< 860px` 5-tab bottom navigation bar).

---

## 2. Color Palette & Semantic Tokens

### Core Surfaces (Dark Mode)
| Token | Hex | Usage |
| :--- | :--- | :--- |
| `--bg-void` | `#0D0E11` | Left navigation sidebar, recessed readiness boxes, scrollbar track |
| `--bg-primary` | `#121418` | Primary app background canvas |
| `--bg-input` | `#15181E` | Search inputs, selects, form controls |
| `--bg-elevated` | `#191C22` | Modals, drawers, secondary sub-tab bars |
| `--bg-card` | `#1F232B` | Studio cards, project tiles, KPI pills |
| `--bg-card-hover` | `#262B35` | Interactive card hover state |
| **Spotlight Stage** | `radial-gradient(circle, #282E3B 0%, #14171E 100%)` | Hero backdrop behind miniature photos and Space Marine colour backpacks |

### Brand Accents
| Token | Hex / Value | Usage |
| :--- | :--- | :--- |
| `--gold-primary` | `#EDB304` | Primary CTA buttons, brand crest borders |
| `--gold-bright` | `#FBBA00` | Display titles, active navigation & chip states, focus rings |
| `--gold-soft` | `rgba(237, 179, 4, 0.16)` | Active tab/chip background fill |
| `--gold-border` | `rgba(237, 179, 4, 0.42)` | Highlighted card and active tab borders |
| `--pro-gradient` | `linear-gradient(135deg, #57C2D0 0%, #9E5BD6 50%, #E3A73B 100%)` | Warhammer Pro / Tone Pro range badges and feature callouts |

### Semantic Inventory & Readiness Colors
| Status | Foreground | Background Fill | Meaning |
| :--- | :--- | :--- | :--- |
| **Owned / Ready** | `#29C26A` | `rgba(41, 194, 106, 0.15)` | Directly owned paint/model or `100% Paint Ready` stage |
| **Substitute** | `#38BDF8` | `rgba(56, 189, 248, 0.15)` | Covered by owned Tone Pro or 3rd-party equivalent (Vallejo, Army Painter, etc.) |
| **Wishlist** | `#F59E0B` | `rgba(245, 158, 11, 0.15)` | Saved to shopping wishlist |
| **Missing** | `#EF4444` | `rgba(239, 68, 68, 0.15)` | Required paint not yet owned or substituted |

### Text & Borders
- **Text Primary (`#F4F3EF`):** Warm off-white for body copy, paint names, and card headings.
- **Text Secondary (`#B4B9C4`):** Supporting metadata, faction paths, and step techniques.
- **Text Muted (`#7B8292`):** Counts, hex codes, keyboard shortcuts (`⌘K`).
- **Text On Gold (`#111215`):** High-contrast ink on `#EDB304` / `#FBBA00` gold buttons.
- **Borders:** Subtle `rgba(255, 255, 255, 0.08)` for resting cards; Strong `rgba(255, 255, 255, 0.16)` for inputs and modals.

### Original Mobile App Reference Tokens (`Paint Warhammer` Light Mode)
When referencing or adapting layouts from the official mobile app (`screenshots/original-app/`):
- **Light Gallery Canvas (`#F8F8F8` / `#FFFFFF`):** Bright white cards with soft elevation (`0 2px 10px rgba(0, 0, 0, 0.07)`), full-height left-edge color swatch blocks (`64px` wide), and `#000000` `Anton` display headers.
- **Floating Pill Bottom Navigation:** Translucent white floating capsule (`Paint Model`, `Paint Colour`, `Hobby Desk` with `#007AFF` active selection pill) paired with a detached circular `Search` button and `#FBBA00` `+` FAB / `+ Add To Project` primary pill.

---

## 3. Typography

Authentic fonts extracted from the official APK (`public/fonts/`):

1. **Display & Section Headings — `Anton` (`anton_regular.ttf`)**
   - Always `uppercase`, weight `400`, `letter-spacing: 0.04em`, tight `line-height: 1.15`.
   - **Page / Model Title (`h1`):** `2.0rem` (`32px`), `#FBBA00` (`--gold-bright`).
   - **Section / Modal Title (`h2`, `h3`):** `1.15rem`–`1.55rem` (`18px`–`25px`), `#F4F3EF` or `#FBBA00`.
   - **KPI Numbers:** `1.5rem` (`24px`) in `Anton` for scannable inventory/project counts.
2. **Editorial & Recipe Copy — `Bitter` (`bitter_regular.otf`, `bitter_bold.otf`, `bitter_italic.otf`)**
   - Base size `15px`, `line-height: 1.5`. Used for painting instructions, recipe step descriptions, and project notes.
3. **UI Controls, Badges & Metadata — System Sans (`Inter` / `system-ui`)**
   - Used for buttons (`14px`, weight `600`), filter chips (`12.8px`, weight `600`), uppercase status badges (`11.5px`, weight `700`, `letter-spacing: 0.03em`), and monospace hex/hash pills (`12px`).

---

## 4. Shape, Spacing & Elevation

- **Corner Radii:**
  - `6px` (`--radius-xs`): Compact buttons, thumbnail selectors, readiness rows.
  - `10px` (`--radius-sm`): Standard buttons, inputs, navigation links, KPI pills.
  - `14px` (`--radius-md`): Studio cards (`.studio-card`), hero banners.
  - `20px` (`--radius-lg`): Modal panels (`.modal-panel`).
  - `9999px` (`--radius-pill`): Filter chips, status badges, circular swatches.
- **Shadows & Glass:**
  - Resting Card: `0 8px 24px rgba(0, 0, 0, 0.35)` with `1px` subtle border; hover lifts `translateY(-2px)` with gold border (`rgba(237, 179, 4, 0.42)`).
  - Modal Backdrop: `rgba(6, 7, 10, 0.78)` with `backdrop-filter: blur(6px)`.

---

## 5. Layout & Navigation Patterns

- **Desktop Shell (`>= 860px`):**
  - **Left Sidebar (`260px` sticky, `#0D0E11`):** Brand crest (`ic_warhammerpro.svg`) + `CITADEL COLOUR` title at top; 4 primary navigation links (`Hobby Desk`, `Paint A Model`, `Paint A Colour`, `Search ⌘K`) with item count pills; compact Inventory/Wishlist summary card; Account/Sync status card pinned at bottom.
  - **Main Viewport (`max-width: 1560px`, `24px 28px` padding):**
    - List views use a top hero header with KPI pills, horizontal sub-tab bar, search + filter chip toolbar, and responsive CSS Grid cards.
    - Detail views (`Model Recipe Detail`, `Colour Detail`) use a **2-column Hero Split** (`1.15fr` interactive visual stage on left, `1fr` metadata + progressive stage readiness on right) followed by full-width progressive painting area steps below.
- **Mobile Shell (`< 860px`):**
  - Sidebar collapses into a fixed `66px` frosted glass **5-Tab Bottom Navigation Bar** (`Hobby Desk`, `Paint Model`, `Paint Colour`, `Search`, `Account`) and single-column stacked cards.

---

## 6. Signature Domain Components

1. **Glossy Paint Swatch (`.paint-swatch`):** `34px` (`52px`–`56px` in detail headers) circle with `2px solid rgba(255, 255, 255, 0.22)` and `inset 0 2px 4px rgba(255, 255, 255, 0.25)` so dark blacks and bright metallics remain distinct against dark cards.
2. **Interactive `(x, y)` Miniature Colour Pins (`.colour-pin`):** `24px` circular colour swatches overlaid at normalized coordinates on miniature photography with a `2px` `#FFFFFF` border; hover/active scales `1.35x` with a `#FBBA00` ring and `4px` gold glow.
3. **Progressive 3-Stage Readiness System:** Every recipe and colour progresses through **`1. Base Finish`** (Basic), **`2. Detail Finish`** (Battle Ready), and **`3. Artificer Finish`** (Parade Ready), paired with ownership match percentages and inline substitute pills (`⇄ Covered by ...`).
4. **Tone Pro 1–5 Pentad Strip:** Horizontal 5-step tonal progression strip (`1` darkest shadow to `5` brightest highlight) inside the Paint Detail Modal, highlighting the active paint in gold and marking owned steps with a green dot.
5. **Cross-Brand Equivalence Card:** Side-by-side Citadel vs. 3rd-party swatch comparison displaying brand/range label, hex code, perceptual color distance badge (`ΔE`), and 1-click Inventory (`✓ Own`) / Wishlist (`★`) toggles.

