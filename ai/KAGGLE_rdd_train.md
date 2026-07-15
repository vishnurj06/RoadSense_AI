# A-2 + A-3 — RDD India → 2-class (pothole + crack) model, on Kaggle

We finally have real crack data: **RDD2022 India** (`aliabdelmenam/rdd-2022`), already YOLO format,
5,368 train / 1,172 val / 1,166 test. This one dataset does **both**:

- **A-2** — far more (and India-specific) pothole data → better recall.
- **A-3** — real cracks → the dashboard's `crack` filter finally works.

We remap RDD's 5 damage classes down to our **2 contract classes** `[pothole, crack]`, so the result
drops into `infer_service` with **zero code change** (it already outputs those exact names).

> Do this in Kaggle — the dataset is already attached there. Run cells top to bottom.
> **Stop the old cell-19 training first** (it's a 5-class model we won't ship).

---

## Step 0 — GPU + install

```python
import torch
print("GPU:", torch.cuda.is_available(), torch.cuda.get_device_name(0) if torch.cuda.is_available() else "")
!pip install ultralytics -q
```

---

## Step 1 — Confirm the dataset path and its class indices

```python
import os
SRC = "/kaggle/input/datasets/aliabdelmenam/rdd-2022/RDD_SPLIT"
print("exists:", os.path.exists(SRC))
print("splits:", os.listdir(SRC))

# what class indices actually appear in the labels?
from collections import Counter
lbl_dir = f"{SRC}/train/labels"
cnt = Counter()
for lf in os.listdir(lbl_dir):
    if lf.endswith(".txt"):
        with open(os.path.join(lbl_dir, lf)) as f:
            for line in f:
                if line.strip():
                    cnt[int(line.split()[0])] += 1
print("class index -> #boxes in train:", dict(sorted(cnt.items())))
```

Note the index counts — potholes are usually far fewer than cracks, which is one clue.

---

## Step 2 — VERIFY which index is the pothole (do NOT skip)

Your notebook guessed the names 3 times and likely swapped pothole with "other". The model learns
*indices*, so we must know for certain which index is potholes before remapping.

```python
import os, cv2
import matplotlib.pyplot as plt
from collections import defaultdict

img_dir = f"{SRC}/train/images"
lbl_dir = f"{SRC}/train/labels"

by_class = defaultdict(list)
for lf in os.listdir(lbl_dir):
    if not lf.endswith(".txt"):
        continue
    with open(os.path.join(lbl_dir, lf)) as f:
        for line in f:
            if line.strip():
                c = int(line.split()[0])
                if len(by_class[c]) < 1:
                    by_class[c].append(lf)

for c in sorted(by_class):
    lf = by_class[c][0]; stem = lf[:-4]
    ip = next((f"{img_dir}/{stem}{e}" for e in (".jpg", ".png", ".jpeg")
               if os.path.exists(f"{img_dir}/{stem}{e}")), None)
    im = cv2.cvtColor(cv2.imread(ip), cv2.COLOR_BGR2RGB); h, w = im.shape[:2]
    with open(os.path.join(lbl_dir, lf)) as f:
        for line in f:
            p = line.split()
            if int(p[0]) != c:
                continue
            x, y, bw, bh = map(float, p[1:5])
            cv2.rectangle(im, (int((x-bw/2)*w), int((y-bh/2)*h)),
                              (int((x+bw/2)*w), int((y+bh/2)*h)), (255, 0, 0), 4)
    plt.figure(figsize=(6, 6)); plt.imshow(im)
    plt.title(f"CLASS INDEX {c}", fontsize=16); plt.axis("off"); plt.show()
```

**Look at each image. A pothole is a filled dark hole in the road; cracks are thin lines / networks.**
Write down which index is the pothole and which are cracks. (Send me the screenshots and I'll confirm.)

---

## Step 3 — Set the mapping from what you saw in Step 2

**Confirmed from the Step 2 images (2026-07-15):** in THIS dataset the pothole is **index 4**, not 3.
Index 3 is the "other" class (boxes on road edge / lane lines) and gets dropped.

```python
POTHOLE_INDEX = 4          # index 4 showed the potholes
CRACK_INDICES = [0, 1, 2]  # cracks (longitudinal / transverse / alligator)
# index 3 ("other corruption") is NOT listed, so it is dropped
```

---

## Step 4 — Remap RDD India → clean 2-class dataset

```python
import os, shutil

DST = "/kaggle/working/roadsense_rdd_india"
CLASSES = ["pothole", "crack"]

# start clean (removes any earlier all-countries build so counts are exact)
if os.path.exists(DST):
    shutil.rmtree(DST)

remap = {POTHOLE_INDEX: 0}
for c in CRACK_INDICES:
    remap[c] = 1
print("remap (rdd index -> our index):", remap)

# RDD uses 'val'; we output 'valid' to match our other tooling
SPLIT_IN_OUT = {"train": "train", "val": "valid", "test": "test"}

for in_split, out_split in SPLIT_IN_OUT.items():
    os.makedirs(f"{DST}/{out_split}/images", exist_ok=True)
    os.makedirs(f"{DST}/{out_split}/labels", exist_ok=True)
    img_dir = f"{SRC}/{in_split}/images"
    lbl_dir = f"{SRC}/{in_split}/labels"
    kept = 0
    for img in os.listdir(img_dir):
        if not img.startswith("India"):        # India-only: RDD names files by country
            continue
        stem, ext = os.path.splitext(img)
        if ext.lower() not in {".jpg", ".jpeg", ".png"}:
            continue
        lines = []
        lbl = f"{lbl_dir}/{stem}.txt"
        if os.path.exists(lbl):
            with open(lbl) as f:
                for line in f:
                    p = line.split()
                    if p and int(p[0]) in remap:
                        lines.append(" ".join([str(remap[int(p[0])])] + p[1:]))
        # symlink image (fast, no gigabytes copied); write the remapped label
        link = f"{DST}/{out_split}/images/{img}"
        if not os.path.exists(link):
            os.symlink(f"{img_dir}/{img}", link)
        with open(f"{DST}/{out_split}/labels/{stem}.txt", "w") as f:
            f.write("\n".join(lines))
        kept += 1
    print(f"{out_split}: {kept} India images")
```

---

## Step 5 — Write `data.yaml` and sanity-check

```python
with open(f"{DST}/data.yaml", "w") as f:
    f.write(f"path: {DST}\ntrain: train/images\nval: valid/images\ntest: test/images\n"
            f"nc: {len(CLASSES)}\nnames: {CLASSES}\n")
print(open(f"{DST}/data.yaml").read())

# count how many boxes of each class survived the remap — BOTH should be non-zero
from collections import Counter
c = Counter()
for lf in os.listdir(f"{DST}/train/labels"):
    for line in open(f"{DST}/train/labels/{lf}"):
        if line.strip():
            c[int(line.split()[0])] += 1
print("train boxes -> pothole(0):", c[0], " crack(1):", c[1])
```

**Stop and check:** both `pothole` and `crack` box counts must be **> 0**. If `pothole` is 0, your
`POTHOLE_INDEX` in Step 3 is wrong — fix it and re-run Step 4.

---

## Step 6 — Train

```python
from ultralytics import YOLO

model = YOLO("yolov8s.pt")
model.train(
    data=f"{DST}/data.yaml",
    epochs=100,
    imgsz=640,
    batch=16,
    optimizer="AdamW",
    lr0=0.001,
    patience=20,
    cache=True,
    workers=2,
    project="/kaggle/working/runs",
    name="roadsense_v3_rdd",
)
```

RDD India is big — expect this to take a while. Keep the tab active. `project=` is on
`/kaggle/working` so `best.pt` is saved as notebook output even if the session ends.

---

## Step 7 — Did it work? (overall + per class)

```python
metrics = model.val(split="test")
print("TEST mAP50   :", round(float(metrics.box.map50), 4))
print("TEST mAP50-95:", round(float(metrics.box.map),   4))
print("\nPer-class AP50:")
for idx, ap in zip(metrics.box.ap_class_index, metrics.box.ap50):
    print(f"  {model.names[int(idx)]:8s}: {round(float(ap), 4)}")
```

```python
# optimal confidence threshold for CONF_THRESHOLD
from IPython.display import Image
Image("/kaggle/working/runs/roadsense_v3_india/BoxF1_curve.png")
```

**Success looks like:** both `pothole` and `crack` show a non-zero AP50. Bring me these numbers.

---

## Step 8 — Get `best.pt` out of Kaggle

```python
from IPython.display import FileLink
best = "/kaggle/working/runs/roadsense_v3_india/weights/best.pt"
print(best, "exists:", __import__("os").path.exists(best))
FileLink(best)   # click to download; or use the notebook's Output/Data panel
```

Then, on your machine — **no code changes**:

1. Put the downloaded `best.pt` at `ai/weights/best.pt`.
2. Edit `ai/.env`:
   ```
   MODEL_VERSION=roadsense-yolov8s-v3-rdd-multiclass
   CONF_THRESHOLD=<number from BoxF1_curve.png, Step 7>
   ```
3. Restart `infer_service`. Your friend's backend now gets **pothole + crack** detections, and the
   dead `crack` filter lights up. Confirm with `curl localhost:8001/health` (model_version) and an
   `/infer` on a crack image.
4. Bring me the Step 7 numbers and I'll write the honest `experiments.md` row.

---

## Later (optional) — fold in your pothole-detection-3 + hard negatives

RDD India alone should be strong. If pothole recall still looks weak, we add your other data:

1. Zip `pothole-detection-3` and `hard_negatives` → **Kaggle → Datasets → New Dataset** → upload →
   **Add Data** to this notebook (they appear under `/kaggle/input/...`).
2. Tell me, and I'll extend Step 4 to merge them in (same remap approach). One more run.
