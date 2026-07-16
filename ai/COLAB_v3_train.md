# A-2 + A-3 — Retrain v3 (multi-class, more data, hard negatives)

This is **one Colab run** that does both tasks at once:

- **A-2** — beat the baseline (val mAP50 **0.556**) by adding *more data*, not more epochs.
- **A-3** — add the **`crack`** class so the dashboard's dead crack filter finally lights up.

Read [experiments.md](experiments.md) first if you haven't — the short version is: **v2-2 proved that
more epochs / bigger model / higher resolution does nothing on 1,230 images.** The only lever left is
**data**. So this run merges three sources:

| source | gives us | classes kept |
|---|---|---|
| your `pothole-detection-3` (1,230 imgs) | pothole examples you already have | `pothole` |
| a road-damage dataset (you add — see Step 2) | more potholes **+ cracks** | `pothole`, `crack` |
| your 57 dashcam frames (`hard_negatives.zip`) | teaches "empty road ≠ pothole" (kills false positives) | *(none — backgrounds)* |

Final class list: **`['pothole', 'crack']`** (index 0 and 1).

---

## ⚠ What is required from YOU before you start

1. **GPU on.** Colab → `Runtime → Change runtime type → T4 GPU → Save`.
2. **`pothole-detection-3.zip` on your Google Drive.** You already uploaded this for the v2-2 run —
   confirm it's still there at `MyDrive/pothole-detection-3.zip`.
3. **`hard_negatives.zip` on your Google Drive.** I just created it for you at
   `RoadSense_AI/ai/hard_negatives.zip` (57 frames, 23 MB). Drag it into drive.google.com.
4. **A road-damage dataset that has cracks.** This is the one real task on your side — see **Step 2**.
   You need a free **Roboflow** account to grab it in YOLO format. ~5 minutes.

That's it. Everything else is copy-paste.

---

## Step 0 — GPU check

```python
!nvidia-smi
```
If this errors, the GPU isn't on. Fix it (see requirement 1) before doing anything else.

```python
%pip install ultralytics roboflow -q
```

```python
from google.colab import drive
drive.mount('/content/drive')
```

---

## Step 1 — Unzip your existing pothole dataset

```python
import os
os.makedirs('/content/datasets', exist_ok=True)
!unzip -q -o "/content/drive/MyDrive/pothole-detection-3.zip" -d /content/datasets/pothole_src
!ls -R /content/datasets/pothole_src | head -20
```

---

## Step 2 — Add a road-damage dataset (cracks + more potholes)  ← YOUR PART

Go to **[universe.roboflow.com](https://universe.roboflow.com)** and search **"road damage"** or
**"pothole crack"**. Pick a dataset that:

- has **both potholes and cracks** in its class list, and
- offers a **YOLOv8** download.

Good search terms: *road damage detection*, *RDD2022*, *pothole crack detection*. RDD2022-based
datasets are ideal — their classes are longitudinal/transverse/alligator **crack** (D00/D10/D20) and
**pothole** (D40), which is exactly what we want.

On the dataset page: **Download this Dataset → Format: YOLOv8 → show download code**. It gives you a
snippet like the one below. **Paste YOUR snippet here** (your key, workspace, project, version will
differ) and change only the `location=`:

```python
from roboflow import Roboflow
rf = Roboflow(api_key="PASTE_YOUR_KEY")
project = rf.workspace("PASTE_WORKSPACE").project("PASTE_PROJECT")
dataset = project.version(1).download("yolov8", location="/content/datasets/rdd_src")
```

> Don't worry about the dataset's exact class names or how many classes it has. The merge code in
> Step 3 reads them automatically and keeps only potholes and cracks, dropping everything else
> (manholes, line-blur, etc.). You do **not** need to hand-edit anything.

---

## Step 3 — Merge everything into one clean 2-class dataset

Paste this whole cell as-is. It reads each source's own `data.yaml`, remaps class indices by
**name**, and builds a unified dataset at `/content/datasets/roadsense_v3`.

```python
import shutil, yaml
from pathlib import Path

SRC_DATASETS = {
    "pothole": "/content/datasets/pothole_src",   # your 1,230-image dataset
    "rdd":     "/content/road-damage-3",           # the road-damage dataset from Step 2
    # ^ this must match where Roboflow actually downloaded. If you used the default
    #   snippet (no location=), it lands at /content/<project>-<version>, e.g.
    #   /content/road-damage-3. Check with: !ls /content | grep road
}
TARGET  = Path("/content/datasets/roadsense_v3")
# PHASE 1 (now): pothole-only — road-damage-3 had no cracks, so we ship a better
# recall pothole model first. PHASE 2 (later): add an RDD2022 crack dataset as a
# third source in SRC_DATASETS and set CLASSES = ["pothole", "crack"].
CLASSES = ["pothole"]

def target_index(name: str):
    """Map any source class name -> our index, or None to drop it."""
    n = name.strip().lower()
    if "pothole" in n or n == "d40":
        return 0                                   # pothole
    if any(k in n for k in ["crack", "alligator", "longitudinal",
                            "transverse", "linear", "d00", "d10", "d20"]):
        return 1                                   # crack
    return None                                    # drop (manhole, blur, etc.)

def find_root(base):
    base = Path(base)
    if (base / "data.yaml").exists():
        return base
    hits = list(base.rglob("data.yaml"))
    return hits[0].parent if hits else base

def source_names(root):
    y = yaml.safe_load((root / "data.yaml").read_text())
    names = y["names"]
    if isinstance(names, dict):
        names = [names[k] for k in sorted(names)]
    return names

SPLIT_ALIASES = {"train": ["train"], "valid": ["valid", "val"], "test": ["test"]}

for split in SPLIT_ALIASES:
    (TARGET / split / "images").mkdir(parents=True, exist_ok=True)
    (TARGET / split / "labels").mkdir(parents=True, exist_ok=True)

POTHOLE_ROOT = find_root(SRC_DATASETS["pothole"])   # saved for the fair baseline check later

for tag, base in SRC_DATASETS.items():
    root  = find_root(base)
    names = source_names(root)
    idx_map = {i: target_index(nm) for i, nm in enumerate(names)}
    print(f"[{tag}] class map:", {names[i]: idx_map[i] for i in range(len(names))})

    for split, aliases in SPLIT_ALIASES.items():
        src = next((root / a for a in aliases if (root / a / "images").exists()), None)
        if src is None:
            print(f"  ({tag}) no '{split}' split — skipping"); continue
        n = 0
        for img in (src / "images").iterdir():
            if img.suffix.lower() not in {".jpg", ".jpeg", ".png"}:
                continue
            lbl = src / "labels" / f"{img.stem}.txt"
            lines = []
            if lbl.exists():
                for line in lbl.read_text().splitlines():
                    p = line.split()
                    if not p:
                        continue
                    tgt = idx_map.get(int(p[0]))
                    if tgt is None:
                        continue
                    lines.append(" ".join([str(tgt)] + p[1:]))
            stem = f"{tag}_{img.stem}"                       # unique name, no collisions
            shutil.copy(img, TARGET / split / "images" / f"{stem}{img.suffix}")
            (TARGET / split / "labels" / f"{stem}.txt").write_text("\n".join(lines))
            n += 1
        print(f"  ({tag}) {split}: {n} images")
```

---

## Step 4 — Add the hard negatives (your 57 dashcam frames)

An image with an **empty** label file tells YOLO "there is nothing here" — that's how you teach it to
stop calling dashboards and treelines potholes. No labelling needed.

```python
!unzip -q -o "/content/drive/MyDrive/hard_negatives.zip" -d /content/hn

from pathlib import Path
import shutil
hn_imgs = [p for p in Path("/content/hn").rglob("*")
           if p.suffix.lower() in {".jpg", ".jpeg", ".png"}]
for p in hn_imgs:
    shutil.copy(p, TARGET / "train" / "images" / f"hardneg_{p.stem}{p.suffix}")
    (TARGET / "train" / "labels" / f"hardneg_{p.stem}.txt").write_text("")   # empty = background
print(f"added {len(hn_imgs)} hard negatives to train")
```

---

## Step 5 — Write `data.yaml` and sanity-check the counts

```python
(TARGET / "data.yaml").write_text(
    f"path: {TARGET}\n"
    f"train: train/images\n"
    f"val: valid/images\n"
    f"test: test/images\n"
    f"nc: {len(CLASSES)}\n"
    f"names: {CLASSES}\n"
)
print((TARGET / "data.yaml").read_text())

for split in ["train", "valid", "test"]:
    imgs = len(list((TARGET / split / "images").glob("*")))
    print(f"{split}: {imgs} images")
```

**Sanity check before training:** `train` should be clearly larger than your old 1,230 (you've added
the road-damage train set + 57 hard negatives). If `train` is still ~1,230, Step 2 didn't download —
go back and fix it, don't waste a GPU hour.

---

## Step 6 — Train v3

Same recipe as v2-2 (it was never the problem). The **data** is what changed.

```python
from ultralytics import YOLO

model = YOLO("yolov8s.pt")
model.train(
    data=str(TARGET / "data.yaml"),
    epochs=100,
    imgsz=640,
    batch=16,
    patience=20,
    project="/content/drive/MyDrive/roadsense_runs",   # survives a disconnect
    name="v3",
)
```

Expect **~45–90 min** on a T4 (bigger dataset than last time). Keep the tab open — free Colab kills
idle sessions; the `project=` on Drive is your insurance if it dies.

---

## Step 7 — Did it actually get better? (this is the whole point)

### 7a. Overall + per-class on the new test set

```python
metrics = model.val(split="test")
print("TEST mAP50   :", round(float(metrics.box.map50), 4))
print("TEST mAP50-95:", round(float(metrics.box.map),   4))
print("\nPer class AP50:")
for idx, ap in zip(metrics.box.ap_class_index, metrics.box.ap50):
    print(f"  {model.names[int(idx)]:8s}: {round(float(ap), 4)}")
```

### 7b. Fair comparison against the 0.556 baseline

The baseline was measured on your **original pothole-only valid set**. To compare apples-to-apples,
evaluate the new model on that exact set:

```python
from pathlib import Path
cmp = "/content/cmp_pothole.yaml"
Path(cmp).write_text(
    f"path: {POTHOLE_ROOT}\n"
    "train: train/images\nval: valid/images\ntest: test/images\n"
    "nc: 1\nnames: ['pothole']\n"
)
m2 = model.val(data=cmp, split="val")
print("pothole-only valid mAP50:", round(float(m2.box.map50), 4), " (baseline to beat: 0.556)")
```

### 7c. Read the new optimal confidence threshold

```python
from IPython.display import Image
Image("/content/drive/MyDrive/roadsense_runs/v3/BoxF1_curve.png")
```
Note the number in the title — that's your new `CONF_THRESHOLD`.

---

## Step 8 — Ship it

```python
best = "/content/drive/MyDrive/roadsense_runs/v3/weights/best.pt"
print("your new model:", best)
from google.colab import files
files.download(best)     # or just grab it from Drive
```

Then, back on your machine — **no code changes, same as last time**:

1. Put the downloaded `best.pt` at `ai/weights/best.pt`.
2. Edit `ai/.env`:
   ```
   MODEL_VERSION=roadsense-yolov8s-v3
   CONF_THRESHOLD=<the number from BoxF1_curve.png, step 7c>
   ```
3. Restart `infer_service`. Your friend's backend automatically starts seeing better pothole
   detections and a new `model_version`. (Cracks come in phase 2, when you add RDD2022.)
4. Add a row to [experiments.md](experiments.md) with the numbers from Step 7 (I'll help you write it
   up honestly when you have them).

---

## What "done" looks like for this run

- [ ] `train` count went up (Step 5) — proves the merge worked
- [ ] TEST shows a non-zero **`crack`** AP50 (Step 7a) — proves A-3
- [ ] pothole-only valid mAP50 **> 0.556** (Step 7b) — proves A-2 beat the baseline
- [ ] new `best.pt` downloaded, `.env` updated, service restarted (Step 8)

If 7b comes back **below 0.556**, don't panic and don't just add epochs — bring me the per-class
numbers and the train counts and we'll diagnose it (usually means the second dataset was small,
mislabelled, or a very different domain). More/cleaner data is always the fix, never more epochs.
```
