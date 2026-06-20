# Blue-bar diagnosis — unified Plonter clone, אוצם tab (2026-06-04)

**Worker:** Plonter_6_manager_bot worker 1 (opus) — task #6 PART B
**Target:** https://iseemath.co/plonter/clone/?v=12 → click `#tab-vocab` (אוצ"מ)
**Tool:** Playwright Chromium (headless), viewport 1280×800, same-origin DOM + iframe inspection.

## ROOT CAUSE

The "blue bar at the top that loads, like navigating to another address" is **the
vocab.html page header** — the `<div class="header">` element inside the
`#vocab-frame` iframe.

Measured live (iframe `.header`):
- position: `sticky` (top:0, z-index:100) — resolves to a full-width band pinned at the top.
- rect: top=0, left=0, **width=1280 (100%), height≈100px**.
- background: `linear-gradient(135deg, rgb(13,148,136), rgb(8,145,178))`
  = **#0d9488 (teal) → #0891b2 (cyan)**. The cyan end reads as "blue".
- CSS source: `vocab.html` line **16576** — `header{position:relative;padding:12px;background:linear-gradient(135deg,#0d9488,#0891b2);...}` (becomes sticky when in-view).

**Why it looks like "loading / navigating to another address":**
Clicking אוצ"מ points the heavy `#vocab-frame` iframe (`#vocab-view`, a fixed
`inset:0` z-index 50000 full-screen overlay) at **vocab.html — a ~1.1 MB document
plus 8 JS files**. When the iframe is NOT preloaded, that is a real sub-document
navigation: the header (top of the document) paints first at top:0 while the rest
of the page streams in. The user sees a wide teal/cyan band appear at the top
followed by the content filling in — indistinguishable from a normal page load.

**What it is NOT:** it is not a progress bar, not an NProgress/topbar widget, and
not browser chrome. A full DOM sweep for `position:fixed|absolute`, `top<=4`,
blue/thin (`height<=10px`) bars in **both** the parent index document and the
vocab iframe returned **0 candidates** during the entire load window — precisely
because the real culprit is `position:sticky`, not fixed/absolute. (Lesson: scan
sticky/relative top:0 bands too, not only fixed/absolute.)

## Evidence
- DOM measurement during `readyState:"loading"` (274 ms into a forced fresh iframe
  load): `.header` already present at top:0, width 1280, height 100, teal→cyan gradient.
- Screenshots (in projects/פלונטר/tests/clone_verify/):
  - `blbar_vocab_open.png` — tab opened (preloaded): teal/cyan header band at top, full content. No loading flash.
  - `blbar_loading_mid.png` — fresh iframe load mid-stream (readyState=loading): the teal/cyan top band is rendered while the body below is still painting → THIS is the "blue bar that loads".
  - `blbar_loaded_final.png`, `blbar_before.png`, `blbar_after_150ms.png`, `blbar_settled.png`, `blbar_freshload_120ms.png` — supporting frames.
- Raw scan JSON: /tmp/bluebar_result.json (0 fixed/absolute top bars in either doc).

## Recommended minimal fix

**Primary (already deployed in PART A — keep it):** the iframe **preload** added to
index.html (`Preload the אוצם iframe`) loads vocab.html in the background ~1200 ms
after the main app loads, so by the time the tab is clicked the iframe is
`readyState:complete` and the header appears **instantly** with no navigation/load
feel. Confirmed: in the preloaded state, clicking the tab showed the header
immediately (no `loading` window). This already removes the bar for the normal case.

**Close the cold-click race (the one remaining gap, minimal):** if Amitai clicks
אוצ"מ within ~1.2 s of opening the app (before preload runs), the iframe still
loads on click and the bar still appears once. Two small, low-risk options:
1. Kick the preload off on first intent — add `onpointerenter`/`onpointerdown` to
   `#tab-vocab` that calls the existing `preloadVocab()` (start the load a beat
   before the click completes). One-line wiring, no new assets.
2. Optionally start the preload sooner (e.g. `requestIdleCallback` or ~300 ms
   instead of 1200 ms) so the warm-up finishes before a fast first click.

**Optional polish (only if a flash must be eliminated even on a stone-cold first
load):** keep `#vocab-view` hidden until the iframe fires its `load` event (reveal
on load), OR paint `#vocab-view`'s top with the same teal→cyan gradient so the band
is continuous and nothing appears to "pop in". Not required if preload-on-intent is
adopted.

## Limitations
- Headless desktop Chromium, single viewport (1280×800). Amitai's exact device/
  browser (likely mobile) not reproduced; on mobile the same header paint applies,
  and a mobile browser may ALSO surface its own URL-bar progress for the iframe
  navigation — preloading removes both because no navigation happens at click time.
- Did not A/B the proposed pointerdown preload (recommendation only, not yet coded).
