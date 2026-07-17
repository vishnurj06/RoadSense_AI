# RoadSense AI — Phase 3 (Beta) Workflow & Task Split

**Status date:** 2026-07-16
**Repo:** `github.com/vishnurj06/RoadSense_AI` · integration branch: `main`
**Person A:** AI / model (`/ai` only) · **Person B:** Platform (`/backend` + `/frontend` only)

> **How to read this doc:** Phase 2 is done. This is what "Beta" actually costs. Every claim about
> current state below is measured, not assumed — where a number is unverified it says so. The single
> biggest risk is stated up front rather than buried in Part 9.

---

## 0. Where we actually are (end of Phase 2)

> **Audited 2026-07-16** against `main` — by reading the code, not the trackers. Both `claude.md`
> and `docs/codebase_audit_report.md` were **stale on the AI track** at the time of writing (they
> predate v3-merged and report the model as single-class). Verified facts only below.

| Track | State |
|---|---|
| **Platform (B-0 → B-6)** | ✅ Feature-complete. All 7 PRD APIs exist (`/detect`, `/upload`, `/reports`, `/map`, `/analytics`, `/verify`, `/repair`) + auth, PostGIS clustering, repair workflow, 3 dashboards, Redis/MinIO/pagination/health, CI on backend & frontend. **Open defects:** duplicate `/detect-image` (D-2b), fake system-health (G-5), no fleet API (G-6). |
| **AI (A-0 → A-6)** | ✅ Complete **except** the mAP50 ≥ 0.75 target. Local offline inference, Contract v2 `/infer`, 2-class model (`pothole` + `crack`), perspective-corrected severity, real GPS (EXIF/GPX) + `speed_kmph`. |

**Verdict: Phase 2 (MVP) is achieved on both tracks**, with the caveats above and one metric unmet
(mAP50 ≥ 0.75 — see §1, it is near-SOTA and probably the wrong target). Phase 3 has not started.
Phase 4 has not started.

⚠️ **But it was signed off on a `main` that did not run** (D-0). The signoff was premature, not wrong
in spirit — the features are genuinely there. Close §2's debt and the signoff stands.

**Current model — `v3-merged`** (yolov8s, `conf=0.29`), measured on real footage:

| | v2-2 (old) | **v3-merged (shipped)** |
|---|---|---|
| pothole frames hit (of 55) | 43 | **45** |
| false positives on clean road (of 57) | 3 | **0** |
| classes | pothole | **pothole + crack** |

### The three Phase-2 results that shape Phase 3

1. **Training config is not the lever — data is.** `v2-2` changed model size (n→s), epochs (12→100)
   and resolution (416→640) *at once* and moved val mAP50 **0.556 → 0.550**. That hypothesis is
   falsified. Do not re-test it.
2. **The test set decides, not the metric.** `dashcam.mp4` contains **no potholes** — every detection
   on it was a false positive, including the Phase-1 hosted-API ones. `v3-rdd-india` scored fine on
   RDD's test set but collapsed to 18/55 on real footage and was rejected. **Real-footage head-to-head
   is the ship gate.**
3. **A measured heuristic beat an assumed one.** Severity was scoring `corr(depth, severity) = +0.711`
   — it measured how close the *camera* was, not the pothole. Perspective correction dropped that to
   −0.157.

---

## 1. What Beta means — and what it does not

**In scope (this doc):** model quality toward the PRD targets, the remaining PRD detection classes,
metric severity, road segmentation, notifications, Road Health Score, fleet APIs, model registry,
data enrichment (road name / weather), latency, performance validation, field validation.

**Explicitly OUT of scope (park for Phase 4):** production cloud deployment (domain/TLS/managed DB),
99.9% uptime SLA, autoscaling, Flood/Bridge-crack/Traffic-sign/Accident detection, Smart City
analytics, crowdsourced multi-vehicle ingest at scale.

### 🔴 The dominant risk — read this before planning anything

**The PRD's precision ≥95% / recall ≥90% is a data programme, not a sprint.**

Current measured: **precision ~0.59 / recall ~0.43**. Getting to 95/90 on multi-class road damage is
**at or beyond published state of the art** (RDD2022 competition winners land ≈0.65–0.75 F1). It is
not reachable by training harder — that is already proven (see 0.1). It needs **thousands of
correctly-labelled, domain-matched images**, which is weeks of labelling or a paid dataset.

**Recommendation:** treat 95/90 as a **Phase-4 / long-term** target and set an evidence-based Beta
target instead — e.g. **pothole AP50 ≥ 0.65 on real dashcam footage**, reported per-class. Agree this
with your supervisor **before** starting, and put the reasoning in `ai/experiments.md`. Chasing 95%
silently will consume the whole phase and still miss.

---

## 2. Phase-2 debt to close first (do these before any new feature)

> **Updated 2026-07-16 after auditing `main` at `1f01eb2` ("phase 2 signoff").** Two of these are
> new and were found by reading the code, not the docs. **Phase 2 was signed off on a `main` that
> did not run.**

| # | Item | Owner | Why it blocks |
|---|---|---|---|
| **D-0** | 🔴 **`main` was broken at "phase 2 signoff"** — `ai/detect.py` contained **10 unresolved merge-conflict markers** and raised `SyntaxError`. `python detect.py` was dead on the signed-off commit. **Fixed in `42b4edd`** (restored from `f7044ef`). | A (done) | A "signoff" that does not parse is not a signoff. See §2.1 for the root cause and the process fix — **this will recur otherwise.** |
| **D-1** | 🔴 **Hand the weights to Person B** — *still not done* | A | `best.pt` is gitignored, so B **cannot run or verify the model at all**. This has now caused **two** wrong conclusions: the 2026-07-16 audit reporting the model as single-class, and the merge below reverting A-5. Until D-3 exists, transfer the file out-of-band. **This is the single highest-value 2-minute action available.** |
| **D-2** | 🔴 **Delete the stale `feat/ai-phase2` branch** | Both | **Root cause of D-0.** It still holds pre-v3 `ai/` files. Merging it into `main` (`3a3aa52`) conflicted across `ai/`, and `1f01eb2` resolved those conflicts toward the stale side. It is a live landmine — it will do this again. B's `backend/main.py` reconciliation is already resolved in `main`; the branch has no remaining value. |
| **D-2b** | ✅ **`POST /detect-image` was registered twice** — **this was failing CI** (`ruff F811`). **Fixed in `780057d`.** | B (verify) | Same botched merge. Kept the handler at 441 (has S3 + PostGIS clustering + cache invalidation); removed the one at 711 (an older B-1 with none of those — it predates B-2/B-6). FastAPI matches the first route, so the removed block was already dead code: **zero runtime change.** **B: please confirm this was the intended handler.** |
| **D-3** | **Model distribution mechanism** | A + B | The root cause of D-1. See **B3-4** (registry) + **A3-7** (release artifact). Nothing else in Phase 3 works while "how does B get the model?" is answered by WhatsApp. |
| **D-4** | Decide the mAP target (see §1) | Both | Everything in A's track is scoped by this answer. |
| **D-5** | v4 data experiment | A | One bounded run (all RDD countries) — see `ai/KAGGLE_v4_final.md`. **In progress.** Result feeds D-4. **Either outcome is a valid input.** |

### 2.1 The merge incident — read this, it is a process problem, not a people problem

**What happened:** `3a3aa52` merged the stale `feat/ai-phase2` into `main` to settle a
`backend/main.py` conflict. That branch carries the **pre-v3 `ai/` files**, so the merge conflicted
across the AI lane too. `1f01eb2` resolved *all* of it toward the stale side, which:

- left `ai/detect.py` full of raw conflict markers (**SyntaxError — committed and signed off**),
- reverted **A-5** (perspective-corrected severity) back to the bbox-area heuristic that provably
  measures camera distance,
- reset `.env.example` to `v2` / `0.30` while the deployed `best.pt` is **v3-merged / `0.29`**,
- deleted the v3-merged / A-5 / A-6 sections from `experiments.md`.

**Nobody did anything unreasonable.** B was fixing a real conflict in his own file and had no way to
know which side of the `ai/` conflicts was current — **because he has never had the weights (D-1),
so he cannot run the AI code to find out.** D-1 and D-0 are the same root cause wearing two hats.

**The process fixes (agree at S0):**
1. **Delete stale branches the moment they merge** (D-2). This one survived a week and cost a day.
2. **Never resolve a conflict in the other person's lane.** If `ai/` conflicts during a `backend/`
   merge, take **`--theirs` for `ai/`** and ping A — do not adjudicate it.
3. **Protect `main`:** require a PR + one review. Both of these commits went straight to `main`.
4. **A pre-commit / CI check that the repo parses.** `python -m compileall ai backend` would have
   caught D-0 in under a second. **CI currently lints `backend/` only — `ai/` is not checked at all,
   which is exactly why a non-parsing `ai/detect.py` reached `main` with green CI.**

---

## 3. Contract v3 (the ONLY mandatory sync — agree once, then freeze)

Phase 3 adds classes and fields. Both sides break if this drifts.

### 3.1 `POST /infer` — unchanged shape, expanded `class` enum

```json
{
  "model_version": "roadsense-yolov8s-v4",
  "image": { "width": 1280, "height": 720 },
  "inference_ms": 42,
  "detections": [
    {
      "class": "pothole",
      "confidence": 0.91,
      "bbox": [822.0, 573.0, 948.0, 661.0],
      "severity": "high",
      "severity_score": 0.42,
      "depth_cm": 6.4
    }
  ]
}
```

**Frozen rules (carried from v2, still binding):**
- `class` is **always lowercase snake_case**.
- `bbox` is **always** `[x1, y1, x2, y2]` in **absolute pixels**.
- `severity` ∈ `{low, medium, high}` — **Person A owns it, the backend never recomputes it.**
- `detections: []` is a **success (200)**, never an error.
- Every response carries `model_version`.

**New in v3:**
- **`class` enum grows to the PRD's 7** — `pothole`, `road_crack`, `broken_road`,
  `water_filled_pothole`, `patch_repair`, `road_edge_damage`, `speed_breaker`.
  ⚠️ Person B must treat **unknown classes as forward-compatible** (store + display, never 500) so A
  can ship classes incrementally without breaking the dashboard.
- **`severity_score`** (float, nullable) — the raw number behind the bucket, so B can sort/threshold.
- **`depth_cm`** (float, **nullable**) — populated only once A3-3 lands; `null` means "not estimated",
  **never** a guess.

### 3.2 `POST /detect` report — backend-enriched fields

```json
{
  "report_id": "uuid",
  "vehicle_id": "demo-vehicle-1",
  "timestamp": "ISO8601",
  "gps": { "lat": 19.0760, "lon": 72.8777 },
  "speed_kmph": 34.5,
  "gps_source": "gpx",
  "road_name": "Linking Road",
  "weather": "clear",
  "model_version": "roadsense-yolov8s-v4",
  "detections": [ /* as above */ ],
  "image_url": "https://.../frame_0008.jpg"
}
```

- `speed_kmph` — **A** (already shipped, from GPX/EXIF). Nullable.
- **`gps_source`** ∈ `{exif, gpx, faked}` — **A**. New and non-negotiable: the dashboard must be able
  to distinguish a real fix from a placeholder. **`faked` pins must be visually marked in the UI** —
  Phase 2 shipped a map where every pin was random Mumbai jitter and nothing said so.
- `road_name`, `weather` — **B** (enrichment, see B3-5). Nullable.
- **All new fields are optional/nullable**, so every existing fixture and stored report keeps working.

---

## 4. The independence model (unchanged — it worked)

```
                    ┌─────────────────────────────────────────┐
                    │  THE ONLY SEAM: POST /infer             │
                    │  (contract v3, agreed once, §3)         │
                    └─────────────────────────────────────────┘
                            ▲                       ▲
             implements     │                       │   calls
   ┌────────────────────────┴──────┐   ┌────────────┴─────────────────────┐
   │ PERSON A — owns /ai           │   │ PERSON B — owns /backend,/frontend│
   │ model, classes, severity, GPS │   │ API, DB, UI, notifications, infra │
   └───────────────────────────────┘   └──────────────────────────────────┘
```

**Rules:**
1. Neither person edits the other's folder. A owns `/ai`. B owns `/backend` + `/frontend`.
2. `claude.md` is shared — **each person edits only their own track's rows.**
3. Contract v3 frozen after S0. Any change = a 10-minute sync, not a rewrite.
4. Separate branches → PR into `main`. `ai/**` and `backend/**` never collide.
5. **B is never blocked by A**: the stub (`backend/stub_infer.py`) still exists — point
   `INFERENCE_URL` at it and keep building. A ships model improvements behind an endpoint that
   never changes.

---

## 5. PERSON A TRACK (AI / model)

> Owns `/ai` only. Effort figures are estimates, not commitments.

### A3-0 · Close Phase-2 debt — **first, before anything** *(~0.5 d)*
- [ ] Send `best.pt` to B **today** (D-1). Until D-3 lands, out-of-band is the only way.
- [ ] Run the v4 data experiment (`ai/KAGGLE_v4_final.md`) — one bounded run, ~7-9 h (D-5).
- [ ] Agree the Beta accuracy target with B + supervisor and **write the reasoning into
      `ai/experiments.md`** (D-4).
- **Done when:** B can run the model himself, and the target is written down and agreed.

### A3-1 · The remaining 5 PRD classes *(~1-2 weeks — data-bound)*
Currently 2 of 7: `pothole` ✅ `road_crack` ✅.

| class | likely source | honest difficulty |
|---|---|---|
| `patch_repair` | RDD2022 (investigate the index-3 "other" class we dropped) | Medium — may already be in your data |
| `road_edge_damage` | RDD2022 / Roboflow | Medium |
| `broken_road` | Roboflow; overlaps `alligator crack` — **define the boundary first** | Hard — it is a vague label |
| `speed_breaker` | needs a dedicated dataset (Indian speed bumps) | Hard — may not exist publicly |
| `water_filled_pothole` | rare in public datasets | **Hardest — likely needs custom collection** |

- [ ] **Ship incrementally** — one class at a time, per-class AP each time. Do **not** wait for all 5.
- [ ] Define each class in writing *before* labelling. `broken_road` vs `alligator crack` is a
      judgement call that will wreck your labels if two people interpret it differently.
- [ ] Re-verify the class-index mapping visually **every time** the dataset changes. This bit you
      once already (RDD pothole was index 4, not the standard 3).
- **Done when:** ≥4 classes ship with non-zero per-class AP, and `experiments.md` records per-class
  numbers + which classes were abandoned and **why**.

### A3-2 · Accuracy toward the agreed target *(open-ended — bound it)*
- [ ] Act on the v4 result. Data scale helped → invest in data. It did not → the ceiling is label
      quality; say so and stop.
- [ ] **Change one variable per run.** `v2-2` changed three at once and learned nothing.
- [ ] Cheap wins not yet tried: **TTA** (`augment=True`, +2-4 mAP free), higher `imgsz` (small objects
      benefit most), label cleaning.
- [ ] Log **every** run in `experiments.md` — including failures. The rejected `v3-rdd-india` is one
      of the most valuable entries in that file.
- **Done when:** the agreed target is met **or** there is written evidence of why it is not reachable.

### A3-3 · Metric severity — replace the relative score *(~1 week)*
Today's score is **relative, not metric**: proportional to real area but with an unknown
camera-dependent constant, thresholds are tertiles of one video, and `SEVERITY_HORIZON_Y` must be
hand-set per camera.
- [ ] Integrate **monocular depth** (MiDaS / Depth-Anything) → real `depth_cm` (Contract v3 §3.1).
- [ ] Watch the latency budget — depth is a **second model per frame**. Measure `inference_ms`; if it
      blows the <100 ms target, run depth only on frames that already have a detection.
- [ ] Calibrate against **ground truth**: photograph ~20 potholes with a ruler/reference object in
      frame, measure them, check the bucket. **There is currently no ground truth at all.**
- [ ] PRD also wants speed / traffic density / repeat detections in severity — `speed_kmph` is
      already emitted; repeat count is B's (`detection_count` on an issue). Decide who fuses them.
- **Done when:** `depth_cm` is populated, validated against ≥20 measured potholes, and the
  score→bucket mapping is documented.

### A3-4 · Road segmentation *(~4-5 d)*
In the PRD's AI pipeline, never built. Highest-value **false-positive** killer.
- [ ] Segment the drivable surface (pretrained road-seg model, or a Roboflow road dataset).
- [ ] **Discard any detection whose bbox centre is off-road.** This directly kills the treeline and
      dashboard-bezel false positives seen on `dashcam.mp4`.
- [ ] Measure: FP rate on the 57 pothole-free frames must stay **0**, and pothole recall on
      `potholevideos.mp4` must not drop below 45/55.
- **Done when:** FP stays 0 and recall is not regressed. **If it regresses recall, do not ship it.**

### A3-5 · Field validation *(~2-3 d — needs a real drive)*
Two things are code-verified but never exercised in reality:
- [ ] **GPS:** record a real drive with a GPX logger + dashcam, run `detect.py --gpx`, confirm a
      coherent track on B's map (not a random cloud). The code path is unit-verified; a real drive
      has never run through it.
- [ ] **Crack class:** it scores AP50 0.499 on RDD's test set but emits **zero** cracks on
      `potholevideos.mp4` even at conf 0.05 — it is pothole-biased. Shoot footage with real cracks and
      confirm it fires.
- [ ] **Get dashcam footage that contains potholes.** Still missing. `potholevideos.mp4` is handheld
      at pedestrian height — it proves the detector detects potholes, **not** that it works from a
      moving vehicle, which is the actual product.
- **Done when:** one real drive produces a coherent GPS track with real detections, and the crack
  class is confirmed on real crack footage.

### A3-6 · Latency — the PRD's <100 ms/frame *(~2 d)*
**Measured: 103 ms/frame** (yolov8s @640, 6-thread CPU). **Currently failing**, and A3-3/A3-4 each add
a second model.
- [ ] Export **ONNX / OpenVINO** (`model.export(format="openvino")`) — typically **2-3x** on CPU.
- [ ] Re-measure honestly and **state the hardware next to the number**. "<100 ms" is meaningless
      without it.
- [ ] If CPU cannot hold the budget with depth + segmentation, say so and specify the GPU/edge device
      (the PRD already lists Jetson / Pi 5).
- **Done when:** `inference_ms` < 100 on stated hardware, with the full pipeline enabled — or a
  written spec of the hardware that is required.

### A3-7 · Model release artifact *(~1 d — pairs with B3-4)*
The fix for the D-1/D-3 root cause.
- [ ] Publish each model as a **GitHub Release asset** (or S3/MinIO object) with a version, an SHA256
      and its `experiments.md` metrics.
- [ ] `ai/` gains a `fetch_model.py` that downloads by version + verifies the hash.
- [ ] Every release note states: classes, `CONF_THRESHOLD`, real-footage numbers, known weaknesses.
- **Done when:** B can get any model version by running one command, with no message to A.

---

## 6. PERSON B TRACK (Platform)

> Owns `/backend` + `/frontend` only. **Blocked by nobody** — the stub still exists.

### B3-0 · Close Phase-2 debt *(~1 d)* — **verified against the code 2026-07-16**
- [x] ✅ **Duplicate `POST /detect-image` removed** (D-2b, `780057d`) — it was **failing CI**
      (`ruff F811`). Kept 441 (S3 + clustering + cache), removed 711 (older B-1, none of those).
      **Action for B: confirm that was the right handler**, since it was your merge intent.
- [ ] 🔴 **Delete the stale `feat/ai-phase2` branch** (D-2) — it broke `main` once already (§2.1).
      Your `backend/main.py` reconciliation is already in `main`; the branch has no value left.
- [ ] 🔴 **Real** `GET /admin/system-health` (G-5). **Confirmed still hardcoded** — `main.py:902`
      literally returns `cpu_usage_pct: 34.5, memory_usage_pct: 58.2, ...` with the comment
      *"Simulated system stats"*, and `psutil` is not in `requirements.txt`. A dashboard that invents
      its own health metrics is worse than no dashboard — an admin will trust it.
- [ ] **Add `ai/` to CI** — CI runs `ruff check backend/` only. A non-parsing `ai/detect.py` reached
      `main` with **green CI**. At minimum: `python -m compileall ai backend`.
- [ ] Update `task.md` (G-8) or delete it — it contradicts `claude.md`.

### B3-1 · Fleet APIs *(~3-4 d)* *(G-6)*
The Fleet dashboard exists but has no real backend — it derives vehicles from `vehicle_id` on reports.
- [ ] `vehicles` table: id, plate, model, camera_id, last_seen, status.
- [ ] `GET /fleet/vehicles`, `GET /fleet/vehicles/{id}/history`, `POST /fleet/vehicles`.
- [ ] **Camera health** = derive from `last_seen` + report cadence (e.g. no reports in 24 h → stale).
- [ ] Point the Fleet dashboard at the real endpoints.
- **Done when:** a vehicle can be registered, and its camera going quiet is visible in the UI.

### B3-2 · Notifications *(~3-4 d)* — a PRD functional requirement, not started
- [ ] Trigger on **new high-severity verified issue** (not on every report — that is noise).
- [ ] Email first (SMTP/SendGrid). SMS/push only if time allows.
- [ ] `notification_preferences` per user (role, severity threshold, area). **Rate-limit / digest** —
      a pothole-heavy drive will otherwise send 50 emails in a minute.
- [ ] `notifications` table + `GET /notifications` for an in-app bell.
- **Done when:** a new high-severity issue emails the right authority once, and a 50-detection burst
  produces one digest, not 50 emails.

### B3-3 · Road Health Score *(~3 d)*
- [ ] Define it **in writing first** (e.g. per road segment: weighted issue count × severity ÷ length,
      decayed by repair recency). Agree the formula before coding it.
- [ ] `GET /analytics/road-health` + a map choropleth or ranked table.
- [ ] Handle the obvious trap: **more reports ≠ worse road.** A road driven 10x looks worse than one
      driven once. **Normalise by traversal count** or the score is just a popularity contest.
- **Done when:** the score is documented, normalised for coverage, and rendered.

### B3-4 · Model registry *(~3 d — pairs with A3-7)*
The Admin dashboard has a model-management **stub with no API**. This is the D-3 fix.
- [ ] `models` table: version, artifact URL, sha256, classes, conf_threshold, metrics, active flag.
- [ ] `GET /admin/models`, `POST /admin/models` (register), `POST /admin/models/activate`.
- [ ] Activating a version updates `INFERENCE_URL`'s target config — **no redeploy**.
- [ ] Surface `model_version` on every report detail (already stored) so a report traces to its model.
- **Done when:** a new model version can be registered and activated from the Admin UI, and you never
  need to ask A for a file again.

### B3-5 · Data enrichment — `road_name` + `weather` *(~3 d)* — PRD "Data Captured"
- [ ] **Road name:** reverse-geocode GPS (Nominatim/OSM — free, rate-limited; cache aggressively in
      Redis, you will hit the same roads constantly).
- [ ] **Weather:** by GPS + timestamp (OpenWeather historical). **Cache per (grid cell, hour)** — do
      not call per report.
- [ ] Both **nullable and non-blocking**: enrichment failure must **never** fail the ingest. Enrich
      async after insert.
- **Done when:** reports show a road name and weather, and killing the geocoder's network does not
  break `POST /detect-image`.

### B3-6 · Show GPS provenance *(~0.5 d — small but important)*
- [ ] Read `gps_source` (Contract v3 §3.2) and **visually mark `faked` pins** on the map.
- [ ] Filter: "real GPS only".
- **Done when:** nobody can mistake a placeholder pin for a real one in a demo. Phase 2 shipped
  exactly that failure — a map of random Mumbai jitter with nothing indicating it.

### B3-7 · Performance validation *(~2 d)*
The PRD's `<2 s` dashboard and `99.9%` uptime have **never been measured**.
- [ ] Seed **~10k reports**; measure `/map` and `/analytics` p95 (Redis cache on **and** cold).
- [ ] Add DB indexes where the profiler — not intuition — says.
- [ ] Load-test `POST /detect-image` for the PRD's `<5 s` upload latency.
- **Done when:** p95 numbers for `/map`, `/analytics` and upload are written down at 10k reports.

### B3-8 · Frontend hardening *(~3-4 d)*
- [ ] Split `page.js` (**1,064 lines**, G-7) into role-specific route components. It will not survive
      Phase 3's additions.
- [ ] Add frontend tests — currently **zero** (all 16 tests are backend).
- [ ] Handle unknown detection classes gracefully (Contract v3 §3.1) so A shipping `speed_breaker`
      cannot 500 your dashboard.
- **Done when:** no file > ~400 lines, frontend tests run in CI, and an unknown class renders safely.

### B3-9 · Security — the unmet PRD items *(~2-3 d)*
- [ ] **Encrypted uploads** (TLS in transit, SSE at rest on MinIO/S3).
- [ ] **GPS validation** — reject impossible coordinates: out of range, null-island `(0,0)`, or a jump
      implying > 300 km/h between consecutive reports from one vehicle.
- [ ] Rotate `SECRET_KEY` out of `auth.py` into env (it is still in source).
- **Done when:** a report with `(0,0)` or a teleporting vehicle is rejected, and no secret is in git.

---

## 7. Sync points (few, deliberate)

| # | When | Who | What | Duration |
|---|---|---|---|---|
| **S0** | **Before any Phase-3 code** | Both | **Agree + freeze Contract v3 (§3)** and the accuracy target (§1). Mandatory. | ~1 h |
| S1 | A3-0 done | Both | B has the weights and can run the real model himself. **Do this today** — it is one file. | ~15 min |
| S2 | A3-7 + B3-4 done | Both | Model registry live → the weights-by-WhatsApp problem is dead forever. | ~30 min |
| S3 | A ships each new class | Both | B confirms it renders + filters. Repeat per class, not once at the end. | ~15 min each |
| S4 | A3-5 | Both | Real drive → real GPS track on B's map. The first genuinely end-to-end run. | ~2 h |
| S5 | End of Phase 3 | Both | Full dry run from a **fresh clone** + demo rehearsal. | ~3 h |

---

## 8. Suggested order

Each track is sequential within itself and parallel across tracks.

```
        PERSON A                                PERSON B
        ─────────────────────────────           ─────────────────────────────
  S0 ── Contract v3 + target (§3, §1) ───────── Contract v3 + target ──┐  MANDATORY
        │                                        │                     │
   1    A3-0 debt: SEND WEIGHTS + v4 run         B3-0 debt: main.py,   │  ~0.5 d
        │                                             psutil health    │
   2    A3-7 model release artifact ──────────▶  B3-4 model registry   │  ~3 d  ← kills D-3
   3    A3-1 more classes (incremental) ──S3──▶ B3-8 frontend hardening│  ~1-2 w
   4    A3-4 road segmentation                  B3-1 fleet APIs        │  ~4 d
   5    A3-3 metric severity (depth)            B3-2 notifications     │  ~1 w
   6    A3-6 latency (ONNX/OpenVINO)            B3-3 road health score │  ~2-3 d
   7    A3-5 field validation ──────S4────────  B3-5 enrichment + B3-6 │  ~3 d
   8    A3-2 accuracy (ongoing, bounded)        B3-7 perf + B3-9 sec   │  ~3 d
        │                                        │                     │
  S5 ── Integration + demo rehearsal ─────────── Integration ──────────┘
```

**Note step 2:** the model registry is early on purpose. Until it exists, every model handover is
manual and every audit of the AI track is wrong (as already happened).

---

## 9. Definition of Done — Phase 3 (Beta)

- [ ] **Contract v3 frozen** and both sides implement it.
- [ ] **Model registry live** — B pulls any model version himself; no file passed by hand. *(D-3)*
- [ ] **≥4 detection classes** shipping with per-class AP recorded (7 is the PRD goal; 4 is an honest
      Beta bar). Abandoned classes documented with reasons.
- [ ] **Agreed accuracy target met, or evidence of why not**, in `experiments.md`.
- [ ] **`depth_cm` populated** and validated against ≥20 physically measured potholes.
- [ ] **Road segmentation** live with FP still 0 and recall not regressed.
- [ ] **Real drive validated** — coherent GPS track, real detections, on the map. *(A3-5)*
- [ ] **`gps_source` surfaced** — faked pins visibly marked. *(B3-6)*
- [ ] **Notifications** — one email per new high-severity issue, bursts digested.
- [ ] **Fleet APIs** real; camera health derived from real data.
- [ ] **Road Health Score** documented, coverage-normalised, rendered.
- [ ] **`road_name` + `weather`** enriched, and failure never blocks ingest.
- [ ] **Latency < 100 ms/frame on stated hardware**, full pipeline — or a written hardware spec.
- [ ] **p95 measured** for `/map`, `/analytics`, upload at ~10k reports.
- [ ] **Security:** encrypted uploads, GPS validation, no secrets in source.
- [ ] **CI green** on backend **and** frontend, with frontend tests existing.

---

## 10. Honest risk notes

1. **95% precision is the whole phase, if you let it.** See §1. Agree a realistic target at S0 or this
   consumes everything and still misses. This is the single most likely way Phase 3 fails.
2. **Two of the 7 classes may be unobtainable.** `water_filled_pothole` and `speed_breaker` are rare
   in public datasets. Budget for **custom collection**, or drop them explicitly and say why. Do not
   let them silently block A3-1.
3. **Latency is already failing** (103 ms measured) *before* adding depth (A3-3) and segmentation
   (A3-4) — each a second model per frame. ONNX/OpenVINO (A3-6) is not optional; sequence it **before**
   the models that make it worse, or be ready to specify a GPU.
4. **You still have no dashcam footage containing potholes.** Every "does it work?" claim is
   extrapolated from handheld pedestrian-height video. This is the cheapest gap to close and it
   undermines every accuracy claim until it is closed. **Record a drive.**
5. **`best.pt` being gitignored already caused a wrong audit.** Until B3-4/A3-7 land, assume any
   audit of the AI track is wrong unless the auditor has the weights.
6. **Don't repeat `v2-2`.** One variable per run. Three at once cost a GPU session and taught nothing.
7. **Ship gate is real footage, not RDD test AP.** `v3-rdd-india` looked fine on paper and was 2.5x
   worse in reality. The head-to-head (45/55 frames, 0 FP) is the bar to beat.
8. **Road segmentation can hurt recall.** It is a filter — if it drops real potholes near the road
   edge, it is a net loss. Measure both sides before shipping (A3-4).
9. **Beta implies real users.** Nothing here covers support, onboarding, data retention, or privacy
   (dashcam footage of public roads captures faces and plates — check your obligations before any
   real deployment).
