# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

MY·ENG is a single-file PWA for spaced-repetition English vocabulary study, built for Korean learners. It is deployed via GitHub Pages at `https://github.com/Jangho-korea/my-eng`.

**All application code lives in one file: `index.html`.** There is no build step, no bundler, no package.json. Edit `index.html` directly and push — the app updates immediately.

## Deployment

```bash
git add index.html
git commit -m "..."
git push origin main
```

GitHub Pages serves `main` branch directly. No CI, no build pipeline.

## Architecture

`index.html` is ~1600 lines structured as:
1. **`<head>`** — CDN imports: `@supabase/supabase-js@2`, `xlsx@0.18.5`, Google Fonts
2. **`<style>`** — All CSS with CSS custom properties (`--accent`, `--text`, `--surface`, etc.)
3. **`<body>`** — Static HTML shells for each page (`#page-home`, `#page-translate`, `#page-add`, `#page-review`, `#page-words`, `#page-decks`, `#page-stats`). Navigation is tab-based; `showPage(name)` switches the active `.page`.
4. **`<script>`** — All JS: global state, DB layer, and per-page render functions

### Data layer

**Supabase** (Postgres) is the only backend. Credentials are hardcoded in the script (publishable key, safe to commit):

```js
const SUPABASE_URL = 'https://cubrnpnkgehyjhgxvoof.supabase.co';
const SUPABASE_KEY = 'sb_publishable_...';
```

**Tables:**
- `items` — vocabulary cards: `{id, user_id, type ('expr'|'sent'), en, ko, example, example_ko, tag, level (0-6), next_review (date), added_at, srs (jsonb)}`
  - `srs` holds **independent SRS state per review mode**: `{ "ko-en": {level, next_review}, "blank": {...}, "ko-example": {...} }`. Top-level `level`/`next_review` are a denormalized "overall" mirror (max level, earliest due across modes) kept only so home/deck/set due-counts and the stats distribution keep working.
- `decks` — `{id, user_id, name}`
- `sets` — `{id, user_id, deck_id, name}`
- `item_sets` — join table `{user_id, set_id, item_id}`

**In-memory state** (loaded once on login, mutated by CRUD helpers):
```js
let items = [], decks = [], sets = [], itemSets = [];
```

All DB functions (`insertItem`, `updateItem`, `deleteItemDB`, `createDeck`, `deleteDeck`, `createSet`, `deleteSet`, `addItemToSet`, `removeItemFromSet`) update both Supabase and the in-memory arrays together.

**localStorage keys:**
- `my_eng_apikey` / `my_eng_provider` — translation API key & provider
- `my_eng_streak_{userId}` — `{streak, lastStudyDate}` (also mirrored to Supabase `user_metadata.streakData` for cross-device sync)
- `my_eng_review_hist` — `{date: count}` review history, 90-day rolling window (also mirrored to `user_metadata.reviewHist`; `loadAll` merges the cloud copy on login via `mergeReviewHistory`)

### SRS system

Each card carries **per-mode SRS state** in `srs` (jsonb), keyed by review type
(`ko-en`, `blank`, `ko-example`) — `{level (0–6), next_review (ISO date)}` each.
A card is "due today" *within a mode* independently, so finishing one mode never
marks another mode done. `modeSrs(item, type)` reads a track (falling back to the
legacy top-level fields for un-migrated cards); `isModeDue`/`isAnyDue` test due-ness.
Focus mode operates on (and rates) the `ko-en` track. `rateCard` advances only the
active mode's track, then recomputes the denormalized top-level `level`/`next_review`.

```js
// Intervals per level (days):
const days = [1, 3, 7, 14, 30, 60, 120];

// Rating buttons:
// Hard (r=0): level - 1, next_review = srsNext(level-1)
// Okay (r=1): level + 1, next_review = srsNext(level+1)
// Easy (r=2): level + 2, next_review = srsNext(level+2)
```

Due pool: `items.filter(w => !w.next_review || w.next_review <= today())`.

`srsHint(lvl, r)` computes the human-readable interval string shown on rating buttons (e.g. "3 days").

### Review session flow

`renderReview()` → if `savedReview` exists (mid-session state), prompts "Continue" vs "Start fresh". Otherwise calls `showReviewSetup()`.

`startReviewCards()` builds `rQueue` (Fisher-Yates shuffled), calls `nextCard()`.

`nextCard()` serializes current state to `savedReview` (stores IDs, not objects, so Supabase-updated levels are picked up on resume).

Review modes: `'all'`, `'deck:{id}'`, or a set ID (number). Review types: `'ko-en'`, `'blank'`, `'example'`, `'focus'` (focus = level 0-1 only).

### Translation

Calls OpenAI `gpt-4o-mini` or Anthropic `claude-haiku-4-5-20251001` directly from the browser. API key stored in localStorage, never sent to any server other than the AI provider. Uses `anthropic-dangerous-direct-browser-access: true` header for Anthropic.

The translate flow: input English → AI returns `{ko, example, example_ko}` → user confirms → `insertItem()` saves to Supabase.

### Excel import/export

Uses SheetJS (`xlsx`). Import expects columns: `type`, `en`, `ko`, `example`, `example_ko`, `tag`. Export template available in Add tab.

### Service worker

`sw.js` caches `index.html` and `manifest.json` for offline use. Bypasses cache for Supabase and Anthropic API calls. Cache name is `my-eng-v1` — increment this when making breaking changes that need cache busting.

## Key patterns

- **Rendering**: All pages render by setting `innerHTML` of a container element. No virtual DOM or templating library.
- **Escaping**: `esc(s)` for JS string contexts (inside `onclick="..."` attributes), `escHtml(s)` for HTML content.
- **Streak**: Derived from `reviewHistory` via `computeCurrentStreakFromHistory()` (not a stored counter). `updateStreak()` runs when a review session ends. Both the history and streak are synced to Supabase `user_metadata` (`syncReviewDataToCloud`) so they survive across devices.
- **Tags**: Default tags are Work, Daily, Business, Idiom, Phrasal verb, Other. The `tag` field is a free-form string.
- **Level pill display**: level 0 = "NEW" (blue), level 1–3 = "Lv.N" (yellow), level 4+ = "✓" (green).
