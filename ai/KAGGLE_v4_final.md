# v4 — the final bounded training run (all RDD countries)

**One run. One variable: data.** Then we look at the number and stop, either way.

## The hypothesis being tested

Every previous run trained on a *subset*:

| run | train images | mAP50 |
|---|---|---|
| `train-2` | 1,230 (pothole only) | 0.556 |
| `v2-2` | 1,230 (more epochs, bigger model, higher res) | 0.550 ← **config changes did nothing** |
| `v3-merged` | 6,655 (pothole-3 + RDD **India**) | 0.480 (2-class) |
| **`v4-all`** | **~27,000 (pothole-3 + RDD ALL countries)** | **?** |

`v2-2` already falsified "more epochs / bigger model / higher resolution". The only untested lever
is **more data** — and RDD2022 has Japan, Czech, Norway and US sitting unused in the same dataset
you already have attached.

**Read the result honestly:**
- **mAP50 jumps to ~0.6-0.7** → data is the lever. A further run (higher res) is then justified.
- **It barely moves** → you now have *two* independent experiments proving the ceiling is data
  *quality*, not quantity or config. That is your evidence to renegotiate the 0.75 target and close
  Phase 2. **This is a valid result, not a failure.**

## ⏱ Time budget (from YOUR measured numbers)

Your India run: 85 epochs / 5,368 images / **2.181 h** → ~1.5 min per epoch.
All countries ≈ 5x the data → ~7.7 min/epoch.

| step | time |
|---|---|
| Setup + merge (symlink ~27k files, scan) | ~15-20 min |
| **Training** (60 epochs, patience 15) | **~6-8 h** |
| Eval + TTA | ~10 min |
| **Total** | **~7-9 h** |

Fits one Kaggle session (12 h cap) and uses ~8 h of your 30 h weekly quota. **Why 60 epochs, not
100:** 60 epochs over 27k images = the same number of weight updates as 300 epochs over 5.4k. More
data per epoch means you need fewer of them. 100 epochs would risk the 12 h session cap.

> Keep the tab open. `best.pt` saves to `/kaggle/working` every time it improves, so even a dropped
> session keeps the best-so-far.

---

## Step 0 — GPU + install

```python
import torch
print("GPU:", torch.cuda.is_available(), torch.cuda.get_device_name(0) if torch.cuda.is_available() else "")
!pip install ultralytics -q
```
Settings → **Accelerator: GPU T4 x2** and **Internet: On**. Both required.

## Step 1 — Inputs

Both datasets should already be attached from the last run (**RDD 2022** + **roadsense extra data**).

```python
import os
RDD = "/kaggle/input/datasets/aliabdelmenam/rdd-2022/RDD_SPLIT"
P3  = "/kaggle/input/datasets/shadowz7/roadsense-extra-data/pothole-detection-3/pothole-detection-3"
print("RDD ok:", os.path.exists(RDD))
print("P3  ok:", os.path.exists(P3))

# which countries are in there, and how many of each?
from collections import Counter
c = Counter(f.split("_")[0] for f in os.listdir(f"{RDD}/train/images"))
print("train images by country:", dict(c))
print("TOTAL:", sum(c.values()), " (India alone was 5,368 — this is what we were leaving on the table)")
```

## Step 2 — Merge: ALL countries + pothole-3 + hard negatives

Identical to the v3 merge **except one line is gone**: the `startswith("India")` filter.
Class mapping is already verified (RDD index 4 = pothole, 0/1/2 = cracks, 3 = dropped).

```python
import os, shutil, glob

DST = "/kaggle/working/roadsense_v4_all"
CLASSES = ["pothole", "crack"]
POTHOLE_INDEX, CRACK_INDICES = 4, [0, 1, 2]      # verified visually in the v3 run

if os.path.exists(DST):
    shutil.rmtree(DST)
for s in ["train", "valid", "test"]:
    os.makedirs(f"{DST}/{s}/images", exist_ok=True)
    os.makedirs(f"{DST}/{s}/labels", exist_ok=True)

remap = {POTHOLE_INDEX: 0}
for c in CRACK_INDICES:
    remap[c] = 1
print("remap:", remap)

def add_source(tag, triples, remap):
    for out_split, img_dir, lbl_dir in triples:
        if not os.path.isdir(img_dir):
            print(f"  [{tag}] MISSING {img_dir}"); continue
        kept = 0
        for img in os.listdir(img_dir):
            stem, ext = os.path.splitext(img)
            if ext.lower() not in {".jpg", ".jpeg", ".png"}:
                continue
            lines = []
            lbl = f"{lbl_dir}/{stem}.txt"
            if os.path.exists(lbl):
                for line in open(lbl):
                    p = line.split()
                    if p and remap.get(int(p[0])) is not None:
                        lines.append(" ".join([str(remap[int(p[0])])] + p[1:]))
            link = f"{DST}/{out_split}/images/{tag}_{img}"
            if not os.path.exists(link):
                os.symlink(f"{img_dir}/{img}", link)
            with open(f"{DST}/{out_split}/labels/{tag}_{stem}.txt", "w") as f:
                f.write("\n".join(lines))
            kept += 1
        print(f"  [{tag}] {out_split}: {kept}")

# RDD — ALL countries (no filter). This is the whole point of v4.
add_source("rdd", [("train", f"{RDD}/train/images", f"{RDD}/train/labels"),
                   ("valid", f"{RDD}/val/images",   f"{RDD}/val/labels"),
                   ("test",  f"{RDD}/test/images",  f"{RDD}/test/labels")], remap)

# pothole-detection-3 (its single class 0 = pothole)
add_source("p3", [("train", f"{P3}/train/images", f"{P3}/train/labels"),
                  ("valid", f"{P3}/valid/images", f"{P3}/valid/labels"),
                  ("test",  f"{P3}/test/images",  f"{P3}/test/labels")], {0: 0})

# hard negatives -> empty labels = background
hn = glob.glob("/kaggle/input/**/frame_*.jpg", recursive=True)
for p in hn:
    img = os.path.basename(p)
    link = f"{DST}/train/images/hardneg_{img}"
    if not os.path.exists(link):
        os.symlink(p, link)
    open(f"{DST}/train/labels/hardneg_{os.path.splitext(img)[0]}.txt", "w").close()
print(f"  [hardneg] train: {len(hn)}")
```

This step symlinks ~27k files — **give it a few minutes**.

## Step 3 — data.yaml + sanity check

```python
with open(f"{DST}/data.yaml", "w") as f:
    f.write(f"path: {DST}\ntrain: train/images\nval: valid/images\ntest: test/images\n"
            f"nc: {len(CLASSES)}\nnames: {CLASSES}\n")
print(open(f"{DST}/data.yaml").read())

from collections import Counter
c = Counter()
for lf in os.listdir(f"{DST}/train/labels"):
    for line in open(f"{DST}/train/labels/{lf}"):
        if line.strip():
            c[int(line.split()[0])] += 1
print("train images:", len(os.listdir(f"{DST}/train/images")))
print(f"train boxes -> pothole(0): {c[0]}   crack(1): {c[1]}")
```

**STOP unless:** `train images` is **~27,000** (v3 was 6,655 — if it still says ~6.6k the country
filter is still in) and **both** class counts are > 0.

## Step 4 — Train (~6-8 h)

`yolov8s` and `imgsz=640` are held **identical to v3 on purpose** — change one variable (data) or the
result tells you nothing.

```python
from ultralytics import YOLO

model = YOLO("yolov8s.pt")
model.train(
    data=f"{DST}/data.yaml",
    epochs=60,            # 60 x 27k = same updates as 300 x 5.4k. 100 would risk the 12h cap.
    imgsz=640,            # held constant vs v3
    batch=16,
    optimizer="AdamW",
    lr0=0.001,
    patience=15,
    cache=False,          # 27k images will NOT fit in RAM — must be False or the session dies
    workers=2,
    project="/kaggle/working/runs",
    name="v4_all",
)
```

> `cache=False` matters. v3 used `cache=True` on 6.6k images; 27k will blow Kaggle's RAM.

## Step 5 — Evaluate, and get TTA for free

```python
metrics = model.val(split="test")
print("TEST mAP50   :", round(float(metrics.box.map50), 4))
print("TEST mAP50-95:", round(float(metrics.box.map),   4))
print("\nPer-class AP50:")
for idx, ap in zip(metrics.box.ap_class_index, metrics.box.ap50):
    print(f"  {model.names[int(idx)]:8s}: {round(float(ap), 4)}")
```

```python
# Test-time augmentation — usually +2-4 mAP for zero training. Slower inference.
tta = model.val(split="test", augment=True)
print("TTA mAP50:", round(float(tta.box.map50), 4), " (vs plain above)")
```

```python
from IPython.display import Image
Image("/kaggle/working/runs/v4_all/BoxF1_curve.png")   # -> new CONF_THRESHOLD
```

## Step 6 — Ship it

```python
from IPython.display import FileLink
best = "/kaggle/working/runs/v4_all/weights/best.pt"
print(best, "exists:", __import__("os").path.exists(best))
FileLink(best)
```

Download → save as **`ai/weights/best-v4-all.pt`** (new name, don't overwrite). Bring me:

1. **Per-class AP50** (pothole vs crack)
2. **TTA vs plain** mAP50
3. The **BoxF1** number

I'll rerun the head-to-head on `potholevideos.mp4` + the hard negatives. **We only ship it if it
beats v3-merged on real footage (45/55 frames, 0 false positives)** — the RDD test number alone has
never been the decider, and it isn't now.

---

## The rule for this run

**One run. Then stop and write up Phase 2**, whatever the number says. Do not start a grind toward
0.75 — it's near-SOTA for multi-class road damage, and a good experiment log that says *"we tested
data scale and here's what happened"* is worth more than a number chased for two weeks.
