# Future Ideas & Feature Roadmap

## 1. Community & User Model Builds (Showcases & Kitbashes)

Allow users to upload and share their own completed or work-in-progress miniature builds attached to catalog models (or standalone custom entries):

- **Photo Uploads:** Upload multiple high-resolution photos of a painted/built miniature (front, back, detail shots, WIP stages) stored via Firebase Storage, with optional interactive `(x, y)` pins similar to official model guides.
- **Paints Used:** Tag the exact paints used on the build—supporting Citadel Classic, Citadel Tone Pro, 3rd-party paints (Vallejo, Army Painter, Pro Acryl, Two Thin Coats, AK), and custom mixes/ratios per area or stage (`Base`, `Detail`, `Artificer`).
- **Kitbashing & Conversions (Other Kits Used):** Link other miniature kits from the model catalog (`4,531` models) or custom bitz sources that were combined to kitbash or convert the model, with notes on which parts came from which kit.
- **Tools, Brushes & Hobby Supplies Used:** Record which brushes, airbrushes, primers, basing materials, glues, magnifiers, or hobby tools were used to assemble and paint the model.
- **Integration with Inventory & Projects:**
  - View user builds directly on a model's detail page (`ModelDetailComponent`) alongside the official Citadel recipe.
  - Check **"Can I Paint This Build?"** readiness against the viewer's own paint & model inventory.
  - Clone a community build's paint recipe into a personal Hobby Desk project.

---

## 2. Sponsored & Affiliate Links (Paints, Brushes, Tools & Kits)

Monetization and convenience layer connecting missing supplies and build breakdowns to online hobby retailers:

- **Paint Purchase Links:** Display affiliate/sponsored buy links on the Paint Detail modal, **Missing Paints** project rollup (`ProjectDetailComponent`), and **Paint Wishlist** (`HobbyDeskComponent`) across Citadel and 3rd-party brands (e.g., Element Games, Wayland Games, Amazon, Monument Hobbies, The Army Painter, local game stores).
- **Brushes, Tools & Basing Supplies:** Include sponsored/affiliate product links for recommended or user-tagged brushes, hobby knives, clippers, wet palettes, primers, and basing materials on official guides and user-submitted builds.
- **Miniature Kits & Kitbash Sources:** Link out to purchase miniature kits from the **Model Wishlist**, model detail pages, and kitbash component lists on user builds.
- **Smart Shopping Cart / Restock Rollup:** One-click "Shop Missing Base Paints" or "Export Shopping List" that links to retailers for just the paints needed to reach `1. Base Finish` (or full `Artificer Finish`) on a project or model.

