# RoadSense AI — Decisions To Make

> These are the choices **only you can make** before the build work can proceed. Everything else in
> [`PRD_Review_and_Actions.md`](PRD_Review_and_Actions.md) (PRD edits, code, tests) waits on these.
>
> Each decision below: **the question · the options · my recommendation · what it unblocks.**
> Date: 2026-07-18

---

## ✅ ALL 7 DECIDED (2026-07-18)

| # | Decision | **Call made** |
|---|---|---|
| 1 | Cloud vs edge | **Cloud now, edge later** |
| 2 | Class scope | **4 classes + water flag** (pothole, crack, broken road, edge damage; drop speed breaker + patch repair) |
| 3 | Weather field | **Keep, label "for future use"** |
| 4 | #1 user | **Authority first** ⚠️ *needs a data-seeding plan — authorities need a filled map to see value* |
| 5 | Real dashcam footage | **Yes — commit** (highest-value action) |
| 6 | Privacy (blur faces/plates) | **Commit, build before launch** (not blocking private testing) |
| 7 | Accuracy target | **Measure first, then commit** (let the footage set the number) |

*Details and reasoning for each below.*

---

## Decision 1 — Accuracy target (the D-4 blocker) 🔴 highest priority

**Question:** The PRD demands **precision ≥95% / recall ≥90%**. This is *proven unreachable* by more
data or more training (the ceiling is label quality). What is the new, honest target?

| Option | Meaning |
|---|---|
| A. Keep 95% | Dishonest — already falsified twice. Not recommended. |
| B. **Re-baseline on real footage** *(recommended)* | Target = "detects X% of potholes on real dashcam footage, <5% false positives." Measured, defensible. |
| C. Invest in relabelling | The only path with real headroom, but slow + expensive. A separate project. |

**➡️ Recommendation: B** — set the target from the real-footage ship gate you already use. Requires
Decision 5 (get footage) to set the exact number.
**Unblocks:** Non-functional Requirements, Success Metrics, the whole "is it done?" question.

---

## Decision 2 — Who is the #1 user?

**Question:** Authorities and Fleets want different things. Who do you design and sell for *first*?

| Option | Meaning |
|---|---|
| A. **Authority** | The buyer who fixes roads. Dashboard optimised for repair decisions. |
| B. **Fleet** | The data source. Product optimised for easy camera deployment + vehicle protection. |

**➡️ Recommendation: lean Fleet as the data engine, Authority as the buyer** — but you must pick the
*primary* one, because it decides who the dashboard is built for and who pays.
**Unblocks:** Target Users, dashboard priorities, business model.

---

## Decision 3 — Cloud now, edge later?

**Question:** Does the AI run in the cloud (built) or on a chip in the vehicle (edge, not built)?

| Option | Meaning |
|---|---|
| A. **Cloud now, edge later** *(recommended)* | Ship what's built; move to edge at scale when bandwidth forces it. |
| B. Edge now | Months of new work (hardware + shrinking the model). Not ready. |

**➡️ Recommendation: A** — already validated in our discussion; just needs to be made official + written
into the PRD.
**Unblocks:** System Overview, Hardware (smartphone = beta device), frame-sampling work.

---

## Decision 4 — Class scope: how many?

**Question:** The PRD lists 7 detection classes. Each new class needs thousands of hand-labels. How many?

| Option | Meaning |
|---|---|
| A. **4 classes + water flag** *(recommended)* | Pothole, Crack, Broken Road, Road Edge Damage. Drop Speed Breaker + Patch Repair (wrong for this product); Water-filled = a flag. |
| B. All 7 | Expensive, and 2 don't fit a road-damage product. |

**➡️ Recommendation: A** — build 4 that matter; drop the 2 that aren't road damage.
**Unblocks:** Detection Classes, AI Pipeline, the labelling roadmap.

---

## Decision 5 — Get real dashcam footage? (the practical unlock) 🔴

**Question:** Every accuracy claim is from **handheld** footage. No model has been tested from a moving
vehicle. Will you commit to getting real dashcam footage + one recorded drive?

| Option | Meaning |
|---|---|
| A. **Yes — get footage** *(strongly recommended)* | Unblocks Decision 1's number, GPS validation, and the biggest untested risk — all at once. |
| B. No | Then the product stays unproven and Decision 1 can't be set honestly. |

**➡️ Recommendation: A** — this is the single highest-value action in the entire review.
**Unblocks:** Decision 1, GPS tests, field validation (A3-5), real-device latency.

---

## Decision 6 — Weather field: keep or drop?

**Question:** Weather is captured but shown nowhere. Keep it or remove it?

| Option | Meaning |
|---|---|
| A. **Keep, labelled "future use"** *(recommended)* | Cheap to store; may feed degradation prediction later. Just don't call it a feature. |
| B. Surface it now | Only if a dashboard actually uses it. |
| C. Drop the column | If it will never be used. |

**➡️ Recommendation: A** — keep collecting, mark "for future use."
**Unblocks:** Data Captured, Dashboards.

---

## Decision 7 — Privacy: commit to blurring faces & plates?

**Question:** Road photos capture pedestrians' faces and licence plates = personal data, a legal issue
for real deployment. Commit to blurring before storage?

| Option | Meaning |
|---|---|
| A. **Yes — add blurring** *(recommended before any public deployment)* | Required to be lawful. Adds a processing step. |
| B. Defer | Acceptable only for closed testing, never for a real launch. |

**➡️ Recommendation: A** for anything public; B is fine only while testing privately.
**Unblocks:** Security, deployment readiness.

---

## Summary — decide these, in this order

| # | Decision | Priority |
|---|---|---|
| 5 | Get real dashcam footage | 🔴 Do first — unblocks the most |
| 1 | Re-baseline accuracy target | 🔴 Blocks "is it done?" (needs #5) |
| 2 | #1 user (Authority vs Fleet) | 🟡 Shapes product + business |
| 3 | Cloud now / edge later | 🟢 Confirm + document |
| 4 | Class scope 7 → 4 | 🟢 Confirm + document |
| 6 | Weather keep/drop | 🟢 Quick call |
| 7 | Privacy blurring | 🔴 Before any public launch |

**Once these 7 are decided, the PRD edits, code work, and tests in the main doc can all proceed.**
