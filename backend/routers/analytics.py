from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import text
from datetime import datetime, timedelta
import math

import models
import schemas
import auth
from database import get_db

router = APIRouter(prefix="/analytics", tags=["analytics"])

@router.get("", response_model=dict)
def get_analytics(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    from main import get_cache, set_cache
    cache_key = "cache_analytics"
    cached = get_cache(cache_key)
    if cached is not None:
        return cached

    reports_count = db.query(models.Report).count()
    detections = db.query(models.Detection).all()

    severity_counts = {"high": 0, "medium": 0, "low": 0}
    class_counts = {}

    for d in detections:
        sev = d.severity.lower()
        if sev in severity_counts:
            severity_counts[sev] += 1

        cls = d.class_name.lower()
        class_counts[cls] = class_counts.get(cls, 0) + 1

    today = datetime.utcnow().date()
    time_series = []
    for i in range(6, -1, -1):
        target_date = today - timedelta(days=i)
        day_start = datetime.combine(target_date, datetime.min.time())
        day_end = datetime.combine(target_date, datetime.max.time())

        reports_on_day = (
            db.query(models.Report)
            .filter(
                models.Report.timestamp >= day_start,
                models.Report.timestamp <= day_end,
            )
            .all()
        )

        day_counts = {
            "date": target_date.strftime("%b %d"),
            "high": 0,
            "medium": 0,
            "low": 0,
            "total": 0,
        }
        for r in reports_on_day:
            for d in r.detections:
                sev = d.severity.lower()
                if sev in ("high", "medium", "low"):
                    day_counts[sev] += 1
                    day_counts["total"] += 1
        time_series.append(day_counts)

    result = {
        "total_reports": reports_count,
        "total_detections": len(detections),
        "severity_distribution": severity_counts,
        "class_distribution": class_counts,
        "time_series": time_series,
    }
    set_cache(cache_key, result, expire=300)
    return result


@router.get("/road-health", response_model=schemas.RoadHealthResponse)
def get_road_health(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    from main import get_cache, set_cache
    cache_key = "cache_road_health"
    cached = get_cache(cache_key)
    if cached is not None:
        return cached

    sql = """
    WITH hex_grid AS (
        SELECT
            ST_HexagonGrid(100, ST_Transform(geom, 3857)) AS hex_obj
        FROM reports
        WHERE geom IS NOT NULL
    ),
    distinct_hex AS (
        SELECT DISTINCT (hex_obj).geom AS hex_geom, (hex_obj).i, (hex_obj).j
        FROM hex_grid
    ),
    hex_stats AS (
        SELECT
            h.i, h.j,
            ST_Transform(h.hex_geom, 4326) AS hex_geom_4326,
            ST_Centroid(ST_Transform(h.hex_geom, 4326)) AS centroid,
            (SELECT COUNT(*) FROM reports r WHERE ST_Intersects(ST_Transform(r.geom, 3857), h.hex_geom)) AS total_reports,
            (SELECT json_agg(
                json_build_object(
                    'severity', i.severity,
                    'status', i.status,
                    'updated_at', i.updated_at
                )
             ) FROM issues i WHERE ST_Intersects(ST_Transform(i.geom, 3857), h.hex_geom)
            ) AS issues_data
        FROM distinct_hex h
    )
    SELECT
        i, j,
        ST_X(centroid) AS center_lon,
        ST_Y(centroid) AS center_lat,
        total_reports,
        issues_data,
        (
            SELECT json_agg(ARRAY[ST_Y(geom), ST_X(geom)])
            FROM (SELECT (ST_DumpPoints(hex_geom_4326)).geom) AS pts
        ) AS polygon
    FROM hex_stats
    """

    result = db.execute(text(sql)).fetchall()

    segments = []
    now = datetime.utcnow()

    for row in result:
        total_reports = row.total_reports
        issues_data = row.issues_data or []

        # In case json_agg returns [null] due to empty join
        issues_data = [item for item in issues_data if item is not None and item.get("severity")]

        if total_reports == 0 and not issues_data:
            continue

        total_penalty = 0.0
        total_issues = len(issues_data)

        for issue in issues_data:
            severity = issue.get("severity", "low")
            status = issue.get("status", "open")
            updated_at_str = issue.get("updated_at")
            if updated_at_str:
                try:
                    updated_at = datetime.fromisoformat(updated_at_str.replace("Z", "+00:00"))
                    updated_at = updated_at.replace(tzinfo=None)
                except ValueError:
                    updated_at = now
            else:
                updated_at = now

            age_days = (now - updated_at).days
            if age_days < 0:
                age_days = 0

            if status == "resolved":
                base_weight = 1.0
                decay = max(0.0, 1.0 - (age_days / 90.0))
                total_penalty += base_weight * decay
            else:
                if severity == "high":
                    base_weight = 10.0
                elif severity == "medium":
                    base_weight = 5.0
                else:
                    base_weight = 2.0

                escalation = min(1.5, 1.0 + (age_days * 0.01))
                total_penalty += base_weight * escalation

        coverage_factor = max(1.0, math.sqrt(total_reports))
        normalised_penalty = total_penalty / coverage_factor

        health_score = max(0.0, min(100.0, 100.0 - normalised_penalty))

        polygon = row.polygon or []

        segments.append({
            "hex_id": f"hex_{row.i}_{row.j}",
            "center_lat": row.center_lat,
            "center_lon": row.center_lon,
            "health_score": round(health_score, 1),
            "total_issues": total_issues,
            "total_reports": total_reports,
            "polygon": polygon
        })

    response_data = {"segments": segments}
    set_cache(cache_key, response_data, expire=300)
    return response_data
