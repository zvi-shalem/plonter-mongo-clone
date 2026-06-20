# Unified-site (clone) deploy — RESULT (2026-06-04)

**Worker:** Plonter_6_manager_bot worker 1 (opus) — task #4
**Verdict:** ✅ PASS — clone deployed live and smoke-verified.
**Source:** `projects/פלונטר/clone/` → **Target:** `https://iseemath.co/plonter/clone/`
**Backend used by clone:** live absolute `/plonter/api/` (clone has NO own api/ — safety mitigation intact).

## Final URLs (give to Amitai with cache-bust ?v=)
- Main app:  `https://iseemath.co/plonter/clone/?v=10`
- Vocab/אוצם: `https://iseemath.co/plonter/clone/vocab.html?v=10`

(`?v=` is the page cache-bust param. Internal asset bumps applied: `css/style.css?v=4.15.99`, `plonter-logo.png?v=10`.)

## What was uploaded (UPLOAD-ONLY allowlist honored)
index.html, vocab.html, my-content.html, share.html, plonter-logo.png, plonter-logo.svg,
css/ (style.css), fonts/ (3 files), js/ (38 files + adapters/). Total 53 files.
**NOT uploaded:** any `.db` file, any `clone/api/` directory. Verified empty in the /tmp stage before upload and absent on the server after.

## Curl proof (live)
| Artifact | HTTP | Size (bytes) | SHA-256 |
|---|---|---|---|
| index.html | 200 | 21615 | cb2c6d93b1fab4371ae7174d978ae0cb7b14a00a2ac941f4fea0dcda71c67c3a |
| vocab.html | 200 | 1101570 | 1e26d9efe4a3b58411a8f7d93701d7e85cc091fdc418402b4aa92669540bde1e |

Local sizes matched server sizes (index 21615, vocab 1101570, share 144169, my-content 22449).

## Smoke checks
- (a) Real Plonter app HTML — NOT the I-See-Math React SPA fallback:
  - `id="root"` matches = 0 (index) / 0 (vocab); `main.def1f59d.js` = 0. ✅
  - Real markers present: title `פלונטר v4` ×2, `js/app.js` ×1, `Clone API guard` comment ×1 (index); `לימוד מילים` ×2 (vocab). ✅
- (b) API-reference safety (live):
  - index.html: functional `/plonter/api/` refs present; the single `/plonter/clone/api/` string is the **explanatory comment on line 9** ("It must NEVER hit /plonter/clone/api/"), not a call. ✅
  - Live JS audited (auth_widget.js, vocabSync.js, contentSync.js, auth.js, vocabProgressSync.js): `/plonter/clone/api/` = 0 and relative `clone/api` = 0 in every file; all use absolute `/plonter/api/`. ✅
  - Plus belt-and-braces fetch/XHR rewriter in index.html re-routes any stray same-origin `/api/` call to `/plonter/api/`.

## Safety conclusion
The hazard (clone hitting empty `/clone/api/`, dropping to guest-isolation, and WIPING Amitai's real `plonter_vocab_v2`) is mitigated: clone carries no api backend and all calls resolve to the live `/plonter/api/`. Nothing of Amitai's real data was touched by this deploy.

## Not done by worker (per task)
- Did NOT message Amitai (manager owns user comms).
- The one remaining caveat from QA — a real logged-in browser session confirming vocab sets load and `plonter_vocab_v2` stays intact — was NOT performed (no browser login from this worker). Recommend the manager/owner do the live logged-in check before marking central בדיקה #1143 done.

## Connectivity
SFTP port 22 open; upload exit 0. Host home path: `/home/iseemathadmin/plonter/clone/`.

---

# Redeploy (task #5) — back-link fix, 2 files (2026-06-04)

**Verdict:** ✅ PASS — both fixed files redeployed and live-verified.
Uploaded EXACTLY index.html + vocab.html (no js/css/.db/api touched).

| File | HTTP | Size (bytes) | SHA-256 (live) |
|---|---|---|---|
| index.html | 200 | 21620 | 20090dc037d274f589037a885ceae781e56383143aae3d35772a1cc7c7ce59ab |
| vocab.html | 200 | 1102643 | 654dae5de2b24dd4a65656ace3553728a53aa6ca190fb26a25612262a0d938d7 |

Live grep checks:
- vocab.html contains 'Unified-site back-link fix' = 1 ✅ AND 'closeVocabView' = 3 ✅
- index.html contains 'vocab.html?v=11' = 1 ✅

Sizes match local (index 21620, vocab 1102643). Did NOT message Amitai.
