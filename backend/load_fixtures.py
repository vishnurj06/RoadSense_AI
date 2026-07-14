import os
import json
import urllib.request
import urllib.error

API_URL = "http://localhost:8000/detect"
FIXTURES_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "fixtures")


def load_fixtures():
    if not os.path.exists(FIXTURES_DIR):
        print(f"Error: Fixtures directory not found at {FIXTURES_DIR}")
        return

    fixture_files = [f for f in os.listdir(FIXTURES_DIR) if f.endswith(".json")]
    fixture_files.sort()

    print(f"Found {len(fixture_files)} fixture files in {FIXTURES_DIR}")

    success_count = 0
    for filename in fixture_files:
        file_path = os.path.join(FIXTURES_DIR, filename)
        try:
            with open(file_path, "r") as f:
                payload = json.load(f)

            data = json.dumps(payload).encode("utf-8")
            req = urllib.request.Request(
                API_URL,
                data=data,
                headers={"Content-Type": "application/json"},
                method="POST",
            )

            with urllib.request.urlopen(req) as response:
                if response.status == 201:
                    print(f" Successfully loaded: {filename}")
                    success_count += 1
                else:
                    print(f" Failed to load {filename}: Status {response.status}")
        except urllib.error.URLError as e:
            print(
                f" Error connecting to API: {e.reason}. Is the FastAPI server running on http://localhost:8000?"
            )
            break
        except Exception as e:
            print(f" Error loading {filename}: {e}")

    print(
        f"\nFixture load finished. Successfully loaded {success_count}/{len(fixture_files)} reports."
    )


if __name__ == "__main__":
    load_fixtures()
