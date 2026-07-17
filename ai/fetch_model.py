"""Fetch a model by version and verify it against the registry (task A3-7).

WHY THIS EXISTS
---------------
`weights/*.pt` is gitignored, so cloning the repo gives you no model. Until now the answer to
"how does Person B get the weights?" was "message Person A". That cost us twice:

  * a codebase audit reported the model as single-class when it had two — the auditor could not
    load the weights, so could not see the class count;
  * a merge resolved the `ai/` conflicts toward a stale branch, reverting A-5, because the person
    merging could not run the AI code to tell which side was current.

`models.json` + this script replace that with: **`python fetch_model.py`**. One command, no message
to anyone, SHA256-verified.

DESIGN RULES
------------
* **Verify before install.** Download to a temp file, hash it, and only then move it into place. A
  failed or truncated download must never leave a corrupt `best.pt` behind.
* **Fail loudly on mismatch.** A hash mismatch is a hard error, never a warning. Silently running a
  model that is not the one in the registry is exactly the class of bug this script exists to kill.
* **Idempotent.** If the destination already has the right bytes, do nothing.
* **Stdlib only.** No new dependency in `requirements.txt` just to download a file.

PRIVATE REPO
------------
This repo is private, so GitHub release assets need auth. Set a token with `repo` scope:

    export GITHUB_TOKEN=ghp_xxx        # Windows: set GITHUB_TOKEN=ghp_xxx

Without it GitHub answers 404 (not 401) for a private asset, which is why that case is called out
explicitly below — the raw error is actively misleading.
"""

import argparse
import hashlib
import json
import os
import shutil
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

_HERE = Path(__file__).parent
MANIFEST_PATH = _HERE / "models.json"
WEIGHTS_DIR = _HERE / "weights"
_CHUNK = 1 << 20  # 1 MiB


def sha256_of(path):
    """Streamed so a 22 MB model does not sit in memory twice."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(_CHUNK), b""):
            h.update(chunk)
    return h.hexdigest()


def load_manifest():
    if not MANIFEST_PATH.exists():
        sys.exit(f"ERROR: registry not found at {MANIFEST_PATH}")
    # encoding is explicit: models.json is UTF-8, but Windows defaults open() to cp1252,
    # which turns the non-ASCII text in it into mojibake (or raises).
    with open(MANIFEST_PATH, encoding="utf-8") as f:
        m = json.load(f)
    if not m.get("models"):
        sys.exit(f"ERROR: {MANIFEST_PATH} lists no models")
    return m


def describe(version, spec):
    print(f"\n  {version}")
    print(f"      released : {spec.get('released', '?')}")
    print(f"      base     : {spec.get('base', '?')} @ imgsz {spec.get('imgsz', '?')}")
    print(f"      classes  : {', '.join(spec.get('classes', []))}")
    print(f"      conf     : {spec.get('conf_threshold', '?')}")
    print(f"      trained  : {spec.get('trained_on', '?')}")
    met = spec.get("metrics", {})
    real = met.get("real_footage_pothole_frames_hit")
    fp = met.get("real_footage_false_positives")
    if real:
        print(f"      real footage: {real} pothole frames, {fp} false positives")
    for k, v in met.items():
        if k.startswith("_") or k.startswith("real_footage"):
            continue
        print(f"      {k:<24}: {v}")
    for w in spec.get("known_weaknesses", []):
        print(f"      ! {w}")


class _StripAuthOnRedirect(urllib.request.HTTPRedirectHandler):
    """Drop Authorization when a redirect crosses to another host.

    A private-repo release asset redirects to a signed S3/objects URL that already carries its own
    credentials in the query string. urllib re-sends our `Authorization: Bearer ...` to that host,
    and S3 rejects the request with "Only one auth mechanism allowed". Stripping the header on a
    cross-host hop is what curl -L and requests do, and it is the difference between this script
    working and 400-ing for anyone using a token.
    """

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        new = super().redirect_request(req, fp, code, msg, headers, newurl)
        if new is None:
            return None
        if urllib.parse.urlsplit(req.full_url).netloc != urllib.parse.urlsplit(newurl).netloc:
            new.headers = {k: v for k, v in new.headers.items() if k.lower() != "authorization"}
            new.unredirected_hdrs.pop("Authorization", None)
        return new


_OPENER = urllib.request.build_opener(_StripAuthOnRedirect)


def _github_api_asset_url(url, token):
    """Resolve a browser download URL to its API asset URL, which is the supported private-repo path.

    Returns None for anything that is not a github.com release download (e.g. a file:// URL in tests,
    or an S3/MinIO object), so those keep working untouched.
    """
    parts = urllib.parse.urlsplit(url)
    if parts.netloc != "github.com" or "/releases/download/" not in parts.path:
        return None
    # /<owner>/<repo>/releases/download/<tag>/<filename>
    seg = parts.path.strip("/").split("/")
    if len(seg) < 6:
        return None
    owner, repo, tag, filename = seg[0], seg[1], seg[4], seg[5]

    api = f"https://api.github.com/repos/{owner}/{repo}/releases/tags/{tag}"
    req = urllib.request.Request(api)
    req.add_header("Accept", "application/vnd.github+json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with _OPENER.open(req, timeout=30) as r:
            release = json.load(r)
    except (urllib.error.HTTPError, urllib.error.URLError):
        return None  # fall back to the direct URL (fine for a public repo)

    for asset in release.get("assets", []):
        if asset.get("name") == filename:
            return asset.get("url")
    return None


def download(url, dest, token=None):
    # For a PRIVATE repo the browser download URL 404s even with a token; the API asset endpoint is
    # the supported route. Public repos work either way, so this is a safe upgrade, not a special case.
    api_url = _github_api_asset_url(url, token) if token else None
    fetch_url = api_url or url

    req = urllib.request.Request(fetch_url)
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    # GitHub serves the binary (not JSON metadata) only for this Accept type.
    req.add_header("Accept", "application/octet-stream")
    try:
        with _OPENER.open(req, timeout=120) as r, open(dest, "wb") as out:
            shutil.copyfileobj(r, out, _CHUNK)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            sys.exit(
                f"ERROR: 404 for {fetch_url}\n"
                "  A private repo returns 404 (not 401) for release assets when the token is\n"
                "  missing or lacks 'repo' scope, so this may be an AUTH problem, not a missing\n"
                "  file. Check both:\n"
                "    1. Is GITHUB_TOKEN set, with 'repo' scope?\n"
                "    2. Has Person A actually published this release yet? (see ai/README.md)"
            )
        sys.exit(f"ERROR: HTTP {e.code} fetching {fetch_url}: {e.reason}")
    except urllib.error.URLError as e:
        sys.exit(f"ERROR: could not reach {fetch_url}: {e.reason}")


def main():
    manifest = load_manifest()
    p = argparse.ArgumentParser(description="Fetch + verify a RoadSense model from the registry.")
    p.add_argument("--version", default=None, help="registry version (default: manifest 'default')")
    p.add_argument("--list", action="store_true", help="show every version and its real numbers")
    p.add_argument("--dest", type=Path, default=None, help="output path (default: weights/best.pt)")
    p.add_argument("--force", action="store_true", help="re-download even if the hash already matches")
    args = p.parse_args()

    if args.list:
        print(f"registry: {MANIFEST_PATH}\ndefault : {manifest['default']}")
        for v, spec in manifest["models"].items():
            describe(v, spec)
        return

    version = args.version or manifest["default"]
    spec = manifest["models"].get(version)
    if spec is None:
        sys.exit(
            f"ERROR: unknown version '{version}'.\n"
            f"  known: {', '.join(manifest['models'])}\n"
            "  run with --list for details."
        )

    dest = args.dest or (WEIGHTS_DIR / "best.pt")
    dest.parent.mkdir(parents=True, exist_ok=True)
    expected = spec["sha256"]

    # Idempotent: right bytes already on disk -> nothing to do.
    if dest.exists() and not args.force:
        if sha256_of(dest) == expected:
            print(f"{dest} is already {version} (sha256 verified). Nothing to do.")
            _print_next_steps(version, spec)
            return
        print(f"{dest} exists but does NOT match {version} - replacing it.")

    print(f"fetching {version}\n  from {spec['url']}")
    token = os.getenv("GITHUB_TOKEN")
    if not token:
        print("  note: GITHUB_TOKEN not set - required for this private repo's release assets.")

    # Download to a temp file next to dest, so the move is atomic on the same filesystem
    # and a failure can never leave a half-written best.pt in place.
    fd, tmp_name = tempfile.mkstemp(dir=str(dest.parent), suffix=".part")
    os.close(fd)
    tmp = Path(tmp_name)
    try:
        download(spec["url"], tmp, token)

        size = tmp.stat().st_size
        if "size_bytes" in spec and size != spec["size_bytes"]:
            sys.exit(f"ERROR: size mismatch - got {size}, registry says {spec['size_bytes']}")

        actual = sha256_of(tmp)
        if actual != expected:
            sys.exit(
                "ERROR: SHA256 MISMATCH - refusing to install.\n"
                f"  expected {expected}\n"
                f"  actual   {actual}\n"
                "  The download is corrupt, or the published asset is not the one in models.json.\n"
                "  Do NOT use this file. Tell Person A."
            )
        print(f"  sha256 verified: {actual}")
        tmp.replace(dest)
        tmp = None
        print(f"  installed -> {dest}  ({size:,} bytes)")
    finally:
        if tmp is not None and tmp.exists():
            tmp.unlink()  # never leave a .part behind

    _print_next_steps(version, spec)


def _print_next_steps(version, spec):
    print("\nSet these in ai/.env to run it:")
    print(f"  MODEL_VERSION={version}")
    print(f"  CONF_THRESHOLD={spec.get('conf_threshold')}")
    print(f"\nclasses: {', '.join(spec.get('classes', []))}")
    if spec.get("known_weaknesses"):
        print("known weaknesses (run --list for the full text):")
        for w in spec["known_weaknesses"][:2]:
            print(f"  ! {w[:96]}{'...' if len(w) > 96 else ''}")


if __name__ == "__main__":
    main()
