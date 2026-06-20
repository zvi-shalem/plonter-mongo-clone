# Phone-width verification — unified Plonter clone (2026-06-04)

**Worker:** Plonter_6_manager_bot worker 1 (opus) — task #7 (verify only, no deploy/edits)
**Target:** https://iseemath.co/plonter/clone/?v=14
**Env:** Playwright Chromium headless, viewport **390×844, deviceScaleFactor 2, isMobile true, touch on**, wait_until=networkidle.

## Overall verdict: ✅ PASS (all 4 checks)

### CHECK 1 — horizontal overflow (the main thing): PASS
- document.documentElement.scrollWidth = **390**
- document.documentElement.clientWidth = **390**
- window.innerWidth = **390**
- body.scrollWidth = 390
- scrollWidth <= clientWidth+1 → **true (no horizontal page scroll)**

### CHECK 2 — #mode-tabs + children within viewport: PASS
- innerWidth = 390
- #mode-tabs bbox: x=20, width=350, right=370 (≤ 390)
- any .btn child with x+width > innerWidth → **false** (no child overflows)
- Children (tabs wrap into rows via flex-wrap; all rights ≤ 370):
  - שיעורים x=256 w=114 right=370
  - ניתוח x=138 w=114 right=252
  - הינדוס x=20 w=114 right=134
  - טקסטים x=256 w=114 right=370
  - מדיה x=138 w=114 right=252
  - משימות display:none (hidden tab, 0×0)
  - אוצ"מ x=20 w=114 right=134

### CHECK 3 — welcome full-page screenshot: PASS
- /Users/zvishalem/persistent-team/projects/פלונטר/tests/clone_verify/width_home.png
- Visual: content fits 390px wide, tab row wraps cleanly, no clipped/over-edge elements.

### CHECK 4 — open אוצ"מ, host hidden + iframe fills viewport: PASS
- Clicked #tab-vocab, waited 1.5s.
- #welcome-screen computed display = **none** (host hidden) ✓
- #vocab-view: display=block, position=fixed, rect = {x:0, y:0, w:390, h:844}, z-index 50000 ✓
- #vocab-frame rect = 390×844 ✓
- iframe_covers (fills viewport, top-left anchored) → **true** ✓
- Screenshot: /Users/zvishalem/persistent-team/projects/פלונטר/tests/clone_verify/width_vocab.png

## Limitations / Not checked
- Single device profile (390×844 / iPhone-class). Did not sweep multiple widths (320, 360, 414) or landscape.
- Headless Chromium only (no real Safari/Chrome-Android engine).
- Did not log in; checked the public welcome + vocab shell only.
- No deploy or edits performed (verification task).
