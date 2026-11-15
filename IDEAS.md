# Future Ideas & Feature Roadmap

## 1. Community & User Model Builds (Showcases & Kitbashes)

Allow users to upload and share their own completed or work-in-progress miniature builds attached to catalog models (or standalone custom entries):

- **Photo Uploads:** Upload multiple high-resolution photos of a painted/built miniature (front, back, detail shots, WIP stages) stored via Firebase Storage, with optional interactive `(x, y)` pins similar to official model guides.
- **Paints Used:** Tag the exact paints used on the build—supporting Citadel Classic, Citadel Tone Pro, 3rd-party paints (Vallejo, Army Painter, Pro Acryl, Two Thin Coats, AK), and custom mixes/ratios per area or stage (`Base`, `Detail`, `Artificer`).
- **Kitbashing & Conversions (Other Kits Used):** Link other miniature kits from the model catalog (`4,531` models) or custom bitz sources that were combined to kitbash or convert the model, with notes on which parts came from which kit.
- **Tools, Brushes & Hobby Supplies Used:** Record which brushes, airbrushes, primers, basing materials, glues, magnifiers, or hobby tools were used to assemble and paint the model.
- **Integration with Inventory & Projects:**
  - View user builds directly on a model's detail page (`ModelDetailComponent`) alongside the catalog recipe.
  - Check **"Can I Paint This Build?"** readiness against the viewer's own paint & model inventory.
  - Clone a community build's paint recipe into a personal Hobby Desk project.

---

## 2. Sponsored & Affiliate Links (Paints, Brushes, Tools & Kits)

Monetization and convenience layer connecting missing supplies and build breakdowns to online hobby retailers:

- **Paint Purchase Links:** Display affiliate/sponsored buy links on the Paint Detail modal, **Missing Paints** project rollup (`ProjectDetailComponent`), and **Paint Wishlist** (`HobbyDeskComponent`) across Citadel and 3rd-party brands (e.g., Element Games, Wayland Games, Amazon, Monument Hobbies, The Army Painter, local game stores).
- **Brushes, Tools & Basing Supplies:** Include sponsored/affiliate product links for recommended or user-tagged brushes, hobby knives, clippers, wet palettes, primers, and basing materials on official guides and user-submitted builds.
- **Miniature Kits & Kitbash Sources:** Link out to purchase miniature kits from the **Model Wishlist**, model detail pages, and kitbash component lists on user builds.
- **Smart Shopping Cart / Restock Rollup:** One-click "Shop Missing Base Paints" or "Export Shopping List" that links to retailers for just the paints needed to reach `1. Base Finish` (or full `Artificer Finish`) on a project or model.

---

## 3. Community Catalog Proposals (Paints, Models, Factions & Edits)

Allow users to propose additions and corrections to the shared catalog across any miniature wargame or paint ecosystem:

- **Product-Agnostic Scope:**
  - **New Entities:** Propose missing or newly released **Paints** (Citadel, 3rd-party, boutique brands), **Models**, **Factions**, and **Game Systems** (including non-GW miniature lines such as *Marvel: Crisis Protocol*, *Star Wars: Shatterpoint*, *Trench Crusade*, *Infinity*, *Conquest*, and 3D-printed/resin miniatures).
  - **Edits & Corrections to Existing Entries:** Propose accurate hex swatch corrections, cross-brand paint equivalence links, corrected normalized `(x, y)` color pin coordinates on model photos, and step-by-step painting area recipes.
- **Immediate Local Use + Moderator Queue (`catalog_proposals/{proposalId}`):**
  - **Zero-Wait Personal Workflow:** When a user submits a new paint, model, or edit, it is immediately active in their own local/cloud-synced account (using a provisional `local_pending` ID or override) so they can use it in projects and inventory right away.
  - **Community Signal & Moderator Approval:** Proposals enter a Firestore moderation queue where other signed-in users can upvote/confirm accuracy to prioritize high-demand entries for moderators.
  - **Automatic Canonical ID Remapping:** When a moderator approves and publishes a proposal into `catalog_meta/manifest` bundles, the submitter's provisional local references automatically merge and remap to the new canonical catalog ID.

---

## 4. Proposed Public Reference Photos for Catalog Entities

Crowdsourced, copyright-safe visual reference library for models, paints, and color guides:

- **Original User Photography Only (No Scraped Box Art):**
  - Submissions must be user-taken original photos with an explicit license to display in-app; scraped manufacturer webstore or copyrighted box-art images are disallowed.
  - Approved photos display a **Contributor Credit Badge** linking to the submitter's public hobby profile/builds.
- **Supported Reference Categories:**
  - **Models:** Painted miniature angles (front, back, 360°, alternate color schemes), unpainted assembled/sprue views, and scale comparisons.
  - **Paints:** Real-world dried paint swatches applied over **white, grey, and black primer** (on textured plasticard, spoons, or spare bits) to show true metallic, contrast/speedpaint, and glaze behavior alongside bottle photos.
  - **Color Guides:** Real miniature surface examples showing `1. Base Finish`, `2. Detail Finish`, and `3. Artificer Finish` progressions.
- **Staging & Validation Pipeline:**
  - Candidate photos are automatically downscaled client-side (`<= 5 MB`, max `2560px` edge, `JPG`/`PNG`/`WebP`) and uploaded to a staging prefix (`proposals/{uid}/{proposalId}.{ext}`) until approved by a moderator.

---

## 5. Opt-In Public Showcases & "Save to My Reference Photos"

Let users curate personal inspiration boards on any Model or Project by saving public photos from across the app:

- **Privacy-First Showcase Sharing:**
  - Personal **My Painted Model/Project Photos** are private by default and require an explicit **opt-in toggle** ("Share to Public Gallery") per photo or build when signed in.
  - **Private Reference Photos** (`🔒 Private Reference`) are permanently locked as private to the owner and can never be shared publicly.
- **1-Click "Save to My Reference Photos" (Flexible Target Selection):**
  - Any public image in the app—official catalog photos, approved community reference/swatch photos, or another user's opt-in public showcase photo—includes a **"Save to Reference Photos"** action.
  - Users can save with **1 click to the current Model's** reference gallery, or pick **any of their personal Projects or another Model** as the destination (e.g., saving a Blood Angels showcase photo as armor inspiration for a custom chapter project).
- **Rich Recipe & `(x, y)` Pin Preservation:**
  - Saved public references retain linked metadata—creator attribution, source model/build link, tagged paints/recipes, and interactive `(x, y)` color pins—so users can inspect the exact paints used directly inside their private reference Lightbox.
- **Lightweight Pointer Storage, Takedown Respect & Separate Quotas:**
  - **No Duplicate Cloud Blobs:** Saved public photos are stored as lightweight pointers (`sourceType: 'catalog' | 'community_photo'`, `sourcePhotoId`, `sourceUrl`, `authorUid`, `authorDisplayName`, plus the user's own reference note) rather than re-uploading duplicate image files to the saver's Cloud Storage bucket.
  - **Author Unshare/Deletion Lifecycle:** If the original creator unshares or deletes their public showcase photo, saved pointers automatically respect the takedown (replacing the remote image with an unavailable notice while preserving the saver's personal notes and paint tags).
  - **Separate Higher Bookmark Quota:** Because pointer-based saved references do not consume new Cloud Storage bytes, they use a separate, higher quota (e.g., `25` saved public references per model, `30` per project, `1,000` account-wide) independent of raw file upload slots (`5` per model, `6` per project, `250` account-wide).


