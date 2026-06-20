# Share-UI MVP — link-sharing of a vocab category (2026-06-04)

**Worker:** Plonter_6_manager_bot worker 1 (opus) — task #9. **Build-only** (manager deploys to /plonter/clone/ after review). Live backend `content_share_api.php` already deployed + tested.

## Files changed (2)
| File | Change |
|------|--------|
| `clone/vocab.html` | Added practice-share helpers (`_psCatServerId`, `_psCreateShareLink`, `_psShareUrl`, `_psOpenShareDialog`, `_psEsc`, `_psToast`) before `_updateHeaderCategoryActions`, and a **🔗 "שתף קישור לתרגול"** button in the category header actions row (`#vocab-current-actions`), shown only when the category is synced (has a `serverId`). Tag: `PRACTICE_SHARE_20260604`. |
| `clone/share.html` | Added an early `bootShare()` interceptor (replaces the bare `loadInfo()` boot): tries `content_share_api.php?action=resolve_link` FIRST; on a valid `vocab_category` share it `location.replace`s to `vocab.html?cat=<title>` (recipient practices, no account); on expired/revoked it shows a friendly RTL message (`_practiceShareInvalid`); on an unknown token (`"לא קיים"`) or a network error it falls through to the existing vocab_share **recording** flow untouched. Tag: `PRACTICE_SHARE_RESOLVE_20260604`. |

**NOT touched:** `clone/index.html` (manager-owned), `/plonter/api/*` (live backend).

## How it works
- **Owner** opens a synced category → taps 🔗 → `create_share` (POST, `Authorization: Bearer <plonter_auth_token>`, body `{content_id:<serverId>, content_type:'vocab_category', target_type:'link', role:'practice'}`) → RTL dialog shows `https://iseemath.co/plonter/clone/share.html?t=<token>` with **📋 העתק קישור** (clipboard) + toast.
- The category's `content.id` comes from `localStorage['plonter_sync_meta']['vocab_category:'+catName].serverId` (set by `vocabSync.js` on pull). Built-in/un-synced categories have no serverId → the 🔗 button is hidden (create_share needs a content_id).
- **Recipient** opens `share.html?t=<token>` → `resolve_link` (open, no auth) → redirected into `vocab.html?cat=<title>` which already supports the `?cat=` deep-link → practice mode, no account.
- The recording-share (`vocab_share_api`) flow that also uses `?t=` is preserved: only content-share tokens are intercepted; everything else falls through.

## Test results (Playwright, local server http://localhost:8791 serving the clone, API responses route-stubbed)

| Test | Env | Result |
|------|-----|--------|
| T1 resolve_link → redirect to `vocab.html?cat=` | 390×844 mobile | **PASS** (`wait_for_url **/vocab.html?cat=*` matched) — `share_recipient_redirect.png` |
| T2 expired/revoked → friendly RTL "הקישור אינו זמין" | 390×844 mobile | **PASS** (rendered) — `share_invalid_link.png` |
| T3 unknown token → fall through to recording flow | 360-wide | **PASS** (rendered #main = "הקלטה משותפת…", no redirect, no practice-invalid) |
| T4 share dialog opens with correct URL + copy | 390×844 mobile | **PASS** serverId=159, overlay URL `…/share.html?t=tok_demo_123`, 0 console errors — `share_dialog_mobile.png` |
| T4 share dialog | 1280×900 desktop | **PASS** same — `share_dialog_desktop.png` |
| Inline-JS parse (both files) | node `new Function` | **0 parse errors** (vocab 7 scripts, share 2 scripts) |
| Live backend reachability | curl | ping=alive; resolve_link(bogus)=`קישור לא קיים`; create_share(no auth)=`נדרשת התחברות` |

Screenshots in `projects/פלונטר/tests/clone_verify/`: `share_dialog_mobile.png`, `share_dialog_desktop.png`, `share_invalid_link.png`, `share_recipient_redirect.png`.

## Content-count safety check
Re-downloaded live `plonter_content.db` after all testing: `content` row count = **341** (unchanged), `PRAGMA integrity_check` = ok, `content_shares` exists with **0 rows** (auto-created by the deployed API; this worker created none). Sharing only ever adds `content_shares` rows — never touches `content`.

## Blockers / limitations
- **No real authenticated end-to-end:** could not log in (email-OTP, no credentials in this worker), so `create_share` and a REAL token round-trip through `share.html` were verified via route-stubbed responses, not a genuine live token. Creating a live share would also be a live-DB write, out of this task's scope. **Recommend the manager (logged-in) run one real end-to-end after deploy:** create a share on a synced category, open the link in a private window, confirm it lands in `vocab.html?cat=`, then re-check `content` count = 341.
- MVP scope is `vocab_category`; other content types resolve to `vocab.html` (placeholder) — extend per type later.
- The 🔗 button shows only for synced categories (by design). Built-in categories aren't shareable as practice links yet.
- share.html now does one extra `resolve_link` fetch on every open (incl. recording links); ~100-300ms, falls through gracefully if the API is down.
