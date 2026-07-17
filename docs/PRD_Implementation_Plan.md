# RoadSense AI — Implementation Plan (Code Items)

> Concrete build plan for the code items from [`PRD_Review_and_Actions.md`](PRD_Review_and_Actions.md),
> shaped by the 7 decisions in [`PRD_Decisions_To_Make.md`](PRD_Decisions_To_Make.md).
> Ordered **quick wins first**. Effort scale: **S** ≈ half-day · **M** ≈ ~1 day · **L** ≈ 2+ days.
>
> Date: 2026-07-18

---

## How the decisions reshaped the list

- **Decision 3 (weather = "future use, don't surface")** → items **#7 and #11 (weather) are deferred**,
  not built now. Active list = **9 items**.
- **Decision 4 (Authority first)** → the **Priority score (#3)** and **repair queue** are now your most
  important surfaces. Also adds a non-code prerequisite: **seed the map with real data** so authorities
  see value (ties to the footage drive from Decision 5).
- **Decision 6 (privacy before launch)** → **#5 (blur)** is planned now but **scheduled before public
  deployment**, not blocking current testing.

---

## At a glance

| Tier | # | Item | Layer | Effort | Depends on | Migration |
|---|---|---|---|---|---|---|
| **1 — Quick wins** | 4 | Login rate-limiting | Backend | S | — | No |
| | 8 | Notification bell UI | Frontend | M | — | No |
| | 2 | Rename workflow "verified" → "approved" | Both | M | do before #1 | Yes (data) |
| **2 — Authority core** | 1 | Verification threshold (≥2 vehicles) | Backend | M | #2 | Yes (column) |
| | 9 | Show verified vs pending | Frontend | S–M | #1 | No |
| | 3 | Priority score | Backend | M | — | No |
| | 10 | Sort repair queue by priority | Frontend | S | #3 | No |
| **3 — Before launch** | 5 | Privacy blur (faces/plates) | Backend | L | schedule pre-launch | No |
| | 6 | Frame sampling | Backend | M | only if video upload added | No |
| **Deferred (Decision 3)** | 7 | Weather in `/map` | Backend | S | — | No |
| | 11 | Weather display | Frontend | S | #7 | No |

---

# Tier 1 — Quick wins (independent, do first)

## #4 · Login rate-limiting  · Backend · S
**Why:** stop password-guessing (brute force). Self-contained security win.

**Files:**
- `backend/main.py:333` `login_user` (POST `/auth/login`) — insertion point at top (`:337`) and on password-fail (`:340`).
- Reuse `redis_client` (`main.py:38`); **mirror the existing Redis-window pattern** in
  `backend/notification_service.py:60-93` (key template + in-process dict fallback when Redis is `None`).

**Steps:**
1. Add a small limiter helper (new `backend/rate_limit.py`, or in `auth.py`): Redis key
   `login:fails:{username_or_ip}`, sliding window (e.g. 15 min, TTL-based).
2. At the top of `login_user`, if fail-count ≥ threshold (e.g. 5) → return **429 Too Many Requests**.
3. On bad password, increment the counter; on success, delete it.
4. In-process dict fallback so it still works with Redis down (copy `notification_service.py:55-93`).

**No migration.**

---

## #8 · Notification bell UI · Frontend · M
**Why:** the entire notifications backend is built and **completely unconsumed** — alerts are computed and never seen.

**Files:**
- New `frontend/src/components/shell/NotificationBell.js`.
- Mount in `frontend/src/components/shell/PageHeader.js:64` (the existing `{actions}` slot).
- Backend already there: `backend/routers/notifications.py` — `GET /notifications` (`:36`, returns
  `unread_count`), `POST /notifications/{id}/read` (`:102`), `POST /notifications/read-all` (`:140`).
- Copy the fetch + poll patterns from `page.js:209` (`fetchData`, `credentials:"include"`, 401→login) and
  the 60 s `setInterval` at `page.js:298`.

**Steps:**
1. `NotificationBell`: `Bell` icon (lucide) + unread-count badge; dropdown list of notifications.
2. Fetch on mount + poll unread count on an interval (e.g. 60 s).
3. Click a row → `POST /{id}/read`; "mark all read" → `POST /read-all`; refresh count.
4. Render in `PageHeader` actions region.

**No migration.**

---

## #2 · Rename workflow status "verified" → "approved" · Both · M
**Why:** the workflow status "verified" clashes with the *automatic* verification we add in #1. Rename it
**before** #1 so the two concepts never collide. (Suggested name: **"approved"**.)

**Files — backend:**
- `backend/main.py:986-994` `VALID_TRANSITIONS` — `"verified"` is a key (`:988`) and appears in the
  value-sets of `detected` (`:987`) and `assigned` (`:989`).
- Tests: `backend/test_repair.py:78-96`, `backend/test_auth.py:90`.

**Files — frontend (rename in lockstep, or transitions break):**
- `MapComponent.js:95-97` `statusTransitionMap`
- `views/QueueView.js:10-12` (`NEXT_STATUS`, `ACTION_LABEL`, `STAGES`)
- `views/MapView.js:11-12` (`NEXT_STATUS`, `ACTION_LABEL`)
- `lib/classUtils.js:169-177` `STATUS_ORDER` (index 1)
- `shared/Filters.js:151` (`<option value="verified">`)
- Tests: `__tests__/classUtils.test.js:192,214`, `__tests__/Filters.test.js:81,83`

**Steps:**
1. Replace the string `"verified"` → `"approved"` in **all** the sites above, in lockstep.
2. **Alembic data migration:** update existing `issues` rows `status='verified'` → `'approved'`.
3. Update the 4 test files to the new label.

**Migration: yes (data migration for existing rows).**

---

# Tier 2 — Authority-first core value

## #1 · Verification threshold (≥2 distinct vehicles) · Backend · M
**Why:** today **1 report already creates an issue** and `detection_count` increments **per report,
regardless of vehicle** — so "verified" is meaningless. Make an issue "verified" only when **≥2 different
vehicles** have seen it.

**Files:**
- `backend/models.py:18-42` Issue model — add a field (recommend `is_verified Boolean default False`;
  `detection_count` already exists at `models.py:33`).
- `backend/main.py:141` `cluster_report_to_issue` — the attach branch (`:175-220`, where
  `detection_count += 1`) and the new-issue branch (`:238-254`). Called from `:524`, `:685`, `:860`.
- Expose it: `/map` properties (`main.py:837`) + `schemas.py:110-122` `IssueResponse`.
- ⚠️ `frontend/src/lib/mapUtils.js:25-40` **must whitelist the new field** or it's silently dropped
  (documented gotcha at `mapUtils.js:1-14`).

**Steps:**
1. **Alembic migration:** add `issues.is_verified` (Boolean, default False).
2. In the attach branch, after adding the report, compute **distinct `vehicle_id`s** among
   `issue.reports`; if ≥2 → set `is_verified = True`.
3. Add `is_verified` to `/map` properties and `IssueResponse`.
4. Whitelist `is_verified` in `mapUtils.js`.

**Migration: yes (add column).** **Do after #2.**

---

## #9 · Show verified vs pending · Frontend · S–M
**Why:** authorities must see what's confirmed vs a single unconfirmed sighting.

**Files:**
- `MapComponent.js` — popup `IssuePopupContent` facts block (`:250`) or beside the severity headline
  (`:208`); follow the GPS provenance badge precedent (`:229-248`). Optional marker ring via the
  `fakedRing`/`fakedGlyph` pattern in `createMarkerIcon` (`:55-61`).
- `mapUtils.js:25-40` — same whitelist step as #1 (map `is_verified`).

**Steps:**
1. Badge in the popup: **"✓ Verified — N vehicles"** vs **"⏳ Pending — 1 sighting"**.
2. (Optional) a subtle verified ring on the marker.

**Depends on #1.** No migration.

---

## #3 · Priority score · Backend · M
**Why:** severity = "how bad"; **priority = "how urgent"** — the number an authority actually acts on.
No priority concept exists today.

**Files:**
- Compute helper in `backend/main.py` (near `get_map_geojson`, `:750`); add to `/map` properties
  (`:821-839`) and `schemas.py:110-122` `IssueResponse`.
- **Model the formula** on the existing hex penalty in `routers/analytics.py:152-192`
  (weights high=10 / medium=5 / low=2 + age escalation).
- Whitelist `priority` in `mapUtils.js:25-40`.

**Steps:**
1. `compute_priority(issue)` = severity weight × sightings factor (`detection_count`) × age factor.
   (Traffic/road-importance isn't available yet — leave a TODO to fold it in later.)
2. Emit `priority` on `/map` and in `IssueResponse`.
3. Whitelist it in `mapUtils.js`.

**No migration** (computed on read for beta; store later if DB-side sorting is needed).

---

## #10 · Sort repair queue by priority · Frontend · S
**Why:** turn the pending list into a ranked decision tool for authorities.

**Files:**
- `views/QueueView.js:26-32` — the `pending` useMemo currently **sorts by severity only** (`rank` at
  `:27`, `.sort` at `:31`). That `.sort` is the exact anchor.
- (Optional) also reorder map pins at `MapComponent.js:356-362`.

**Steps:**
1. Replace the severity-only sort with a sort on the new `priority` field (severity as tiebreak).

**Depends on #3.** No migration.

---

# Tier 3 — Before launch / conditional

## #5 · Privacy blur (faces + plates) · Backend · L · schedule pre-launch
**Why:** street photos capture faces + plates = personal data; legal blocker for public launch
(Decision 6: build before launch, not blocking private testing).

**Files:**
- `backend/main.py:561` `detect_image` — insert between the re-read (`:627`) and the S3 upload
  (`:629`); the `contents` bytes are exactly what's stored. Or blur inside
  `s3_storage.py:98 upload_image_bytes_to_s3` before `upload_fileobj`.

**Steps:**
1. Pick detector(s): a face detector + a licence-plate detector (net-new ML dependency).
2. Blur the detected boxes (cv2 Gaussian) on the image bytes before upload.
3. Gate behind an env flag (e.g. `BLUR_FACES=1`) so private testing can skip it.

**No migration.** **Schedule before any public deployment.**

---

## #6 · Frame sampling · Backend · M · conditional
**Why:** keep cloud bandwidth sane when video is involved (Decision 1: cloud + sampling).

**Current reality:** the API only accepts **single images** (`/detect-image` rejects non-images,
`main.py:575`); **video is never uploaded**. `ai/extract_frames.py:5` samples every Nth frame but is an
**offline-only** CLI, not wired to the backend.

**Steps (only when video capture is introduced):**
1. Add a video-upload path that runs `extract_frames`-style sampling (every Nth frame).
2. Run inference per sampled frame; store hits.

**No migration.** **Defer until a video/edge capture story exists** — not needed for single-image beta.

---

# Deferred per Decision 3 (weather = future use)

## #7 Weather in `/map` · #11 Weather display
**Not built now.** Weather keeps being *stored* (`models.py:59`, `enrichment.py:93`) but is **not
surfaced**. If you later choose to show it, remember the **3-place rule**: add `weather` to
`main.py:837` `/map` properties → whitelist in `mapUtils.js` → render a `<Row label="Weather">` in the
`MapComponent` popup (`:250`). (Note: `/reports` already returns weather via `ReportResponse`, so
`ReportsView.js` is an easier first surface if wanted.)

---

# Non-code prerequisite (from Decision 4 — Authority first)

**Seed the map with real data.** Authorities need a filled map to see value. Use the footage drive
(Decision 5) or a single pilot vehicle to populate real verified issues before pitching. Not a code
item, but it gates the Authority-first go-to-market.

---

# Suggested build sequence

1. **#4 Login rate-limiting** (S, independent) — warm-up, security.
2. **#8 Notification bell** (M, independent) — visible value, backend already done.
3. **#2 Rename "verified" → "approved"** (M) — clears the way for #1.
4. **#1 Verification threshold** → **#9 verified/pending display** (the pair).
5. **#3 Priority score** → **#10 sort queue by priority** (the pair; core Authority value).
6. **#5 Privacy blur** — before public launch.
7. **#6 Frame sampling** — only when video capture is added.

*Weather (#7/#11) stays parked until you decide to surface it.*

---

## Migrations needed (Alembic)
- **#2** — data migration: `issues.status` `'verified'` → `'approved'`.
- **#1** — schema migration: add `issues.is_verified` (Boolean, default False).

Chain both onto the latest revision; run in the order #2 then #1.
