import os
import sys
import uuid
import random
from datetime import datetime, timedelta

# Add backend directory to path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'backend')))

from database import SessionLocal
import models
from main import cluster_report_to_issue

def generate_random_point(center_lat, center_lon, radius_degrees=0.1):
    lat = center_lat + random.uniform(-radius_degrees, radius_degrees)
    lon = center_lon + random.uniform(-radius_degrees, radius_degrees)
    return lat, lon

def main():
    print("Seeding 10,000 synthetic reports...")
    db = SessionLocal()
    
    # Mumbai center roughly
    center_lat, center_lon = 19.0760, 72.8777
    
    reports = []
    classes = ["pothole", "crack"]
    severities = ["low", "medium", "high"]
    
    batch_size = 500
    
    for i in range(10000):
        lat, lon = generate_random_point(center_lat, center_lon, 0.05) # ~5km spread
        
        # Random time in last 30 days
        timestamp = datetime.utcnow() - timedelta(days=random.uniform(0, 30))
        
        report_id = str(uuid.uuid4())
        report = models.Report(
            id=report_id,
            vehicle_id=f"fleet-{random.randint(1, 50)}",
            timestamp=timestamp,
            latitude=lat,
            longitude=lon,
            geom=f"POINT({lon} {lat})",
            speed_kmph=random.uniform(20.0, 80.0),
            gps_source="faked",
        )
        
        # Add a random detection
        det = models.Detection(
            id=str(uuid.uuid4()),
            report_id=report_id,
            class_name=random.choice(classes),
            confidence=random.uniform(0.5, 0.99),
            bbox=[0, 0, 100, 100],
            severity=random.choice(severities)
        )
        report.detections.append(det)
        
        db.add(report)
        reports.append(report)
        
        if (i + 1) % batch_size == 0:
            print(f"Flushing batch {i+1} / 10000...")
            try:
                db.flush()
                # To properly cluster them, we could call cluster_report_to_issue
                # but doing 10k clusterings synchronously might be slow.
                # Since this is a load test script, we will run the clustering.
                for r in reports:
                    cluster_report_to_issue(db, r)
                db.commit()
                reports = []
            except Exception as e:
                db.rollback()
                print(f"Failed at batch {i+1}: {e}")
                
    db.close()
    print("Done seeding.")

if __name__ == "__main__":
    main()
