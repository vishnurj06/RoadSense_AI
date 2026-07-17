import os
import httpx
import logging
from datetime import datetime
from database import SessionLocal
import models

# It's better to import redis directly if main is problematic, but main has get_cache and set_cache.
# To avoid circular imports, we'll import them locally.

logger = logging.getLogger(__name__)

OPENWEATHER_API_KEY = os.getenv("OPENWEATHER_API_KEY", "")


def fetch_nominatim(lat: float, lon: float) -> str | None:
    from main import get_cache, set_cache

    lat_r = round(lat, 3)
    lon_r = round(lon, 3)
    cache_key = f"enrich:nominatim:{lat_r}:{lon_r}"

    cached = get_cache(cache_key)
    if cached is not None:
        return cached

    url = f"https://nominatim.openstreetmap.org/reverse?lat={lat}&lon={lon}&format=json"
    headers = {"User-Agent": "RoadSense-AI/1.0 (admin@roadsense.ai)"}
    try:
        with httpx.Client(timeout=5.0) as client:
            resp = client.get(url, headers=headers)
            if resp.status_code == 200:
                data = resp.json()
                road_name = data.get("address", {}).get("road")
                if road_name:
                    set_cache(cache_key, road_name, expire=86400)  # cache for 1 day
                    return road_name
    except Exception as e:
        logger.error(f"Nominatim enrichment failed: {e}")
    return None


def fetch_weather(lat: float, lon: float, timestamp: datetime) -> dict | None:
    from main import get_cache, set_cache

    lat_r = round(lat, 2)
    lon_r = round(lon, 2)
    hour = timestamp.strftime("%Y%m%d%H")
    cache_key = f"enrich:weather:{lat_r}:{lon_r}:{hour}"

    cached = get_cache(cache_key)
    if cached is not None:
        return cached

    if not OPENWEATHER_API_KEY:
        mock_weather = {"condition": "Clear", "temperature": 25.0}
        set_cache(cache_key, mock_weather, expire=3600)
        return mock_weather

    url = f"https://api.openweathermap.org/data/2.5/weather?lat={lat}&lon={lon}&appid={OPENWEATHER_API_KEY}&units=metric"
    try:
        with httpx.Client(timeout=5.0) as client:
            resp = client.get(url)
            if resp.status_code == 200:
                data = resp.json()
                weather_info = {
                    "condition": data["weather"][0]["main"]
                    if data.get("weather")
                    else "Unknown",
                    "temperature": data.get("main", {}).get("temp"),
                }
                set_cache(cache_key, weather_info, expire=3600)
                return weather_info
    except Exception as e:
        logger.error(f"OpenWeather enrichment failed: {e}")
    return None


def enrich_report(report_id: str, lat: float, lon: float, timestamp: datetime):
    road_name = fetch_nominatim(lat, lon)
    weather = fetch_weather(lat, lon, timestamp)

    if road_name or weather:
        try:
            db = SessionLocal()
            report = (
                db.query(models.Report).filter(models.Report.id == report_id).first()
            )
            if report:
                if road_name:
                    report.road_name = road_name
                if weather:
                    report.weather = weather
                db.commit()
        except Exception as e:
            logger.error(f"Database error during enrichment: {e}")
        finally:
            db.close()
