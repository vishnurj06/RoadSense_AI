"""Real GPS for Contract v2 reports (task A-6).

Two real sources, tried in priority order by the caller:

  1. **EXIF** — GPS tags embedded in the image itself (a phone photo).
  2. **GPX track** — a recorded drive, interpolated to the frame's timestamp.
     Frames extracted from video carry no EXIF, so this is the dashcam path.

Every function returns `None` rather than guessing, so `detect.py` decides
whether to fall back to a fake fix. Faking is never this module's job.
"""

import math
import xml.etree.ElementTree as ET
from bisect import bisect_left
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

from PIL import Image

# EXIF tag ids we need (values from the EXIF spec; PIL exposes them as ints).
_GPS_IFD = 0x8825
_DATETIME_ORIGINAL = 36867
_GPS_LAT_REF, _GPS_LAT = 1, 2
_GPS_LON_REF, _GPS_LON = 3, 4
_GPS_SPEED_REF, _GPS_SPEED = 12, 13

_EARTH_RADIUS_M = 6_371_000.0

# GPX 1.1 is the near-universal export format (Strava, phones, most loggers).
_GPX_NS = {"gpx": "http://www.topografix.com/GPX/1/1"}


@dataclass
class Fix:
    """One GPS fix. `speed_kmph` is None when the source cannot supply it."""

    lat: float
    lon: float
    speed_kmph: float | None = None
    source: str = "unknown"


def haversine_m(lat1, lon1, lat2, lon2):
    """Great-circle distance in metres. Used for speed between two fixes."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * _EARTH_RADIUS_M * math.asin(math.sqrt(a))


def _dms_to_degrees(dms, ref):
    """EXIF stores lat/lon as (degrees, minutes, seconds) + a N/S/E/W ref."""
    deg, minutes, seconds = (float(v) for v in dms)
    value = deg + minutes / 60.0 + seconds / 3600.0
    # S and W are the negative hemispheres.
    return -value if str(ref).upper() in {"S", "W"} else value


def gps_from_exif(image_path):
    """Read a GPS fix from an image's EXIF tags. Returns None if absent."""
    try:
        with Image.open(image_path) as img:
            exif = img.getexif()
            gps = exif.get_ifd(_GPS_IFD)
    except Exception:
        return None

    if not gps or _GPS_LAT not in gps or _GPS_LON not in gps:
        return None

    try:
        lat = _dms_to_degrees(gps[_GPS_LAT], gps.get(_GPS_LAT_REF, "N"))
        lon = _dms_to_degrees(gps[_GPS_LON], gps.get(_GPS_LON_REF, "E"))
    except (TypeError, ValueError):
        return None

    speed = None
    if _GPS_SPEED in gps:
        try:
            raw = float(gps[_GPS_SPEED])
            # GPSSpeedRef: K=km/h, M=mph, N=knots. Default per spec is K.
            ref = str(gps.get(_GPS_SPEED_REF, "K")).upper()
            speed = {"K": raw, "M": raw * 1.609344, "N": raw * 1.852}.get(ref)
        except (TypeError, ValueError):
            speed = None

    return Fix(lat=lat, lon=lon, speed_kmph=speed, source="exif")


def timestamp_from_exif(image_path):
    """Read DateTimeOriginal, needed to look a frame up in a GPX track."""
    try:
        with Image.open(image_path) as img:
            raw = img.getexif().get(_DATETIME_ORIGINAL)
    except Exception:
        return None
    if not raw:
        return None
    try:
        # EXIF datetimes are local and format "YYYY:MM:DD HH:MM:SS".
        return datetime.strptime(str(raw), "%Y:%m:%d %H:%M:%S").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


class GpxTrack:
    """A time-ordered GPS track that can be sampled at an arbitrary instant."""

    def __init__(self, points):
        # points: list of (datetime, lat, lon). Sorted so we can bisect.
        self.points = sorted(points, key=lambda p: p[0])
        if not self.points:
            raise ValueError("GPX track contains no timestamped track points")
        self._times = [p[0] for p in self.points]

    @classmethod
    def from_file(cls, path):
        root = ET.parse(Path(path)).getroot()
        pts = []
        for trkpt in root.iterfind(".//gpx:trkpt", _GPX_NS):
            time_el = trkpt.find("gpx:time", _GPX_NS)
            if time_el is None or not time_el.text:
                continue  # a point with no time cannot be matched to a frame
            ts = datetime.fromisoformat(time_el.text.strip().replace("Z", "+00:00"))
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            pts.append((ts, float(trkpt.get("lat")), float(trkpt.get("lon"))))
        return cls(pts)

    @property
    def start(self):
        return self._times[0]

    def at(self, when):
        """Interpolate a fix at `when`, with speed from the surrounding segment.

        Timestamps outside the track are clamped to its ends — a frame slightly
        before/after the recording still gets the nearest real position rather
        than a fabricated one.
        """
        if when.tzinfo is None:
            when = when.replace(tzinfo=timezone.utc)

        if when <= self._times[0]:
            _, lat, lon = self.points[0]
            return Fix(lat, lon, self._segment_speed(0), "gpx")
        if when >= self._times[-1]:
            _, lat, lon = self.points[-1]
            return Fix(lat, lon, self._segment_speed(len(self.points) - 1), "gpx")

        i = bisect_left(self._times, when)
        t0, lat0, lon0 = self.points[i - 1]
        t1, lat1, lon1 = self.points[i]

        span = (t1 - t0).total_seconds()
        f = 0.0 if span == 0 else (when - t0).total_seconds() / span
        lat = lat0 + (lat1 - lat0) * f
        lon = lon0 + (lon1 - lon0) * f
        return Fix(lat, lon, self._segment_speed(i), "gpx")

    def _segment_speed(self, i):
        """km/h across the segment ending at point i (distance / elapsed time)."""
        if len(self.points) < 2:
            return None
        i = max(1, min(i, len(self.points) - 1))
        t0, lat0, lon0 = self.points[i - 1]
        t1, lat1, lon1 = self.points[i]
        dt = (t1 - t0).total_seconds()
        if dt <= 0:
            return None
        return round(haversine_m(lat0, lon0, lat1, lon1) / dt * 3.6, 1)


def frame_timestamp(start, index, fps):
    """Timestamp of an extracted frame: start + (index / fps) seconds.

    `extract_frames.py` samples every Nth frame, so the caller must pass the
    *effective* fps of the saved sequence (source fps / every_n_frames).
    """
    return start + timedelta(seconds=index / float(fps))
