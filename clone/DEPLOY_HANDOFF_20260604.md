# Unified-site (clone) safe go-live — handoff for @3 (plonter_3_bot)

**Date:** 2026-06-04
**Requested by:** Amitai (actively chasing — "שלח כבר את האתר המאוחד")
**Routed by:** @6m (router-only; owner @3 owns external SFTP deploy + Amitai notify)
**Exposure window:** 15:00 (allowed slot — NOT a bypass, no @lz exception needed)
**Promised to Amitai:** live link to the unified site at 15:00.

## What this is
The unified Plonter site: vocab/אוצם accessible from one address alongside the
main app. Source = `projects/פלונטר/clone/`. Target URL = `https://iseemath.co/plonter/clone/`.

## Safety state (already mitigated — verified by QA)
- QA report: `projects/פלונטר/tests/clone_verify/QA_REPORT.txt` — verdict PASS_WITH_CAVEATS.
- All `/api/` calls rewritten to ABSOLUTE `/plonter/api/` (the live backend). 0 refs to `/clone/api/`.
  → login succeeds against the real backend, so `auth_widget.js checkSession()` never
  drops to guest-isolation and never WIPES `plonter_vocab_v2` (Amitai's real vocab). This was the hazard.
- Pre-edit backup: `projects/פלונטר/clone.bak_20260528_155550`.

## Deploy steps (run AT the 15:00 window)
1. Latest-state gate: confirm nothing superseded this (check Amitai chat + this file).
2. **Do NOT upload** the empty `.db` files or any `clone/api/` dir — clone must use the live `/plonter/api/` backend only.
3. SFTP upload the clone tree to `iseemath.co/plonter/clone/` (creds in `projects/פלונטר/CLAUDE.md` ## Deployment; copy Hebrew-path files to /tmp first).
   Files: index.html, vocab.html, my-content.html, share.html, css/, js/, fonts/, logos.
4. Cache-bust: bump `?v=` on index.html + vocab.html.
5. **LIVE VERIFY (mandatory — the one unverified caveat):** open `https://iseemath.co/plonter/clone/`,
   log in with a real account, confirm (a) login succeeds, (b) vocab/אוצם loads the real sets,
   (c) the live site's `plonter_vocab_v2` is INTACT (not wiped). If login fails or vocab shows empty,
   STOP and roll back — do not leave it live.
6. Send Amitai the live link via `tg_relay.py --bot plonter_3_bot reply --to amitai`:
   `https://iseemath.co/plonter/clone/?v=<n>` — "האתר המאוחד באוויר: פלונטר + אוצם בכתובת אחת 🚀".
7. Mark central בדיקה #1143 done only after Amitai confirms it works.

## If anything blocks
- SFTP port-22 refused (DreamHost intermittent): `nc -z -w5 iseemath.co 22`; retry; site stays on prior state so no breakage.
- Notify @6m on completion or block.
