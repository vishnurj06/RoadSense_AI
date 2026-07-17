# RoadSense AI — PRD Review (Summary)

> A one-page condensation of [`PRD_Review_and_Actions.md`](PRD_Review_and_Actions.md).
> Full detail, per-section reasoning, and the Master Action List live in that document.
>
> Date: 2026-07-18 · Sections reviewed: **all 20**

---

## The headline

**The software is built. Almost nothing is proven in the real world.**

Platform ≈ 90% done · AI ≈ 40% done · Overall ≈ 75%. Every feature exists in code; the gaps are
**real-world validation** (a moving vehicle, real data volume, a stopwatch) and the **AI model**
(2 of 7 classes, accuracy targets falsified).

---

## Section-by-section verdict

| # | Section | Verdict |
|---|---|---|
| 1 | Goals | Vague/unmeasurable → made them numeric; split "we control" vs "impact". |
| 2 | Target Users | 5 users → really **3** (Authorities, Fleets, Admin). **Citizens dropped.** |
| 3 | System Overview | Flow OK, but hides the big choice → **cloud now, edge later**. |
| 4 | Hardware | Pi/Jetson is future edge gear. **Beta device = smartphone.** |
| 5 | AI Pipeline | 5 of 7 steps done. **Remove segmentation** (proven harmful); depth = post-beta. |
| 6 | Detection Classes | **1.5 of 7 built.** Cut to **4** + water flag; drop speed breaker + patch repair. |
| 7 | Severity | Only 1 of 5 factors used. Severity = size (+depth later); split out **Priority**; drop speed. |
| 8 | Verification | Strong, but "verified" = seen once. **Require ≥2 sightings.** |
| 9 | Data Captured | 9 of 10 fields captured. Decide **weather**; add **GPS source**. |
| 10 | Backend Stack | Accurate. Rename → **Tech Stack**; add map, Docker. |
| 11 | Dashboards | **All 11 built — strongest section.** Missing: notification bell, weather. |
| 12 | Repair Workflow | Code = PRD exactly. Rename "Verified" (clashes); no real authority has used it. |
| 13 | APIs | All 7 exist, but list is stale — missing whole features. Regroup by feature. |
| 14 | Security | 3 solid, 2 shaky. GPS check was silently broken. **Missing: privacy (blur faces/plates).** |
| 15 | Functional Reqs | Mostly met. Not truly "real-time" (~10 fps). Finish the bell. |
| 16 | Non-functional Reqs | **The honesty crunch.** FP rate smashed (0%); precision falsified; 3 untested. |
| 17 | Future Features | Road Health Score already built (misfiled). Traffic-sign/accident = different product. |
| 18 | Roadmap | 4 empty labels. Add "done-when" lines; sync from CLAUDE.md. |
| 19 | Success Metrics | **Duplicate** of Non-functional. Merge them. |
| 20 | Long-Term Vision | Good. "Crowdsourced" → "fleet vehicle data". |

---

## What's genuinely strong ✅

- **Zero false positives** (0/57) on real footage — the best result in the project.
- **Duplicate clustering** (verification engine) — the real moat.
- **All 11 dashboard features** built and working.
- **Repair workflow** — code matches the PRD exactly; a thoughtful state machine.

## What's genuinely weak 🔴

- **Accuracy targets are falsified** — 95% precision unreachable by scaling (ceiling = label quality).
- **Only 2 of 7 classes** — and crack barely fires on real video.
- **No validation from a moving vehicle** — every result is out-of-domain (handheld footage).
- **Privacy is absent** — street photos capture faces + plates; a legal blocker for deployment.

---

## The 4 decisions that unblock everything

1. **Re-baseline accuracy targets** (D-4) — replace 95% precision with an honest, measured number.
2. **Pick the #1 user** — Authority (buys/fixes) vs Fleet (drives/generates data).
3. **Confirm cloud-now / edge-later** — and write it into the PRD.
4. **Lock class scope 7 → 4** — pothole, crack, broken road, edge damage (+ water flag).

## The 1 action that unblocks the most

**Get real dashcam footage from a moving vehicle.** It clears the accuracy re-baseline *and* the
biggest untested risk in one move.

---

*Full reasoning, code references, and the complete 4-bucket action list (Decisions · PRD edits · Code ·
Tests) are in [`PRD_Review_and_Actions.md`](PRD_Review_and_Actions.md).*
