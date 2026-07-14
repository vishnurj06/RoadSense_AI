import os
import json
import urllib.request
import urllib.error

API_URL = "http://localhost:8000/detect"

def bulk_ingest():
    # Construct a bulletproof absolute path
    base_dir = os.path.dirname(os.path.abspath(__file__))
    uploads_dir = os.path.join(base_dir, "backend", "static", "uploads")
    
    print(f"Target upload directory (absolute path): {uploads_dir}")

    # Check if target uploads directory exists and find json files there
    json_files = []
    if os.path.exists(uploads_dir):
        json_files = [os.path.join(uploads_dir, f) for f in os.listdir(uploads_dir) if f.endswith(".json")]
        json_files.sort()
    
    # Fallback dynamic search if no files found in the primary folder
    if not json_files:
        print(f"No JSON files found in {uploads_dir}. Performing dynamic search...")
        
        exclude_dirs = {'.venv', 'node_modules', '.git', '.next', '__pycache__'}
        for dirpath, dirnames, filenames in os.walk(base_dir):
            # Exclude folders from walk in-place
            dirnames[:] = [d for d in dirnames if d not in exclude_dirs]
            
            for filename in filenames:
                if filename.endswith(".json"):
                    file_path = os.path.join(dirpath, filename)
                    try:
                        with open(file_path, "r", encoding="utf-8") as f:
                            content = f.read()
                            if "demo-vehicle-1" in content:
                                json_files.append(file_path)
                    except Exception:
                        pass
        
        json_files.sort()

    total_files = len(json_files)
    if total_files == 0:
        print(f"Error: No report JSON files found under {base_dir}.")
        return

    print(f"Found {total_files} JSON reports to ingest:\n")

    success_count = 0
    for file_path in json_files:
        filename = os.path.basename(file_path)
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                payload = json.load(f)
            
            data = json.dumps(payload).encode("utf-8")
            req = urllib.request.Request(
                API_URL, 
                data=data, 
                headers={"Content-Type": "application/json"},
                method="POST"
            )
            
            with urllib.request.urlopen(req) as response:
                if response.status == 201:
                    print(f" [✓] {filename} successfully ingested")
                    success_count += 1
                else:
                    print(f" [✗] {filename} failed: Status {response.status}")
        except urllib.error.URLError as e:
            print(f" [✗] {filename} connection error: {e.reason}")
        except json.JSONDecodeError:
            print(f" [✗] {filename} is not a valid JSON file")
        except Exception as e:
            print(f" [✗] {filename} error: {e}")

    print(f"\nBulk Ingestion Summary: Successfully ingested {success_count}/{total_files} reports.")

if __name__ == "__main__":
    bulk_ingest()
