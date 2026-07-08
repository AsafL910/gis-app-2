import json
from pathlib import Path
from src.main import app

def export_openapi():
    schema = app.openapi()
    output_path = Path(__file__).resolve().parents[2] / "openapi.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(schema, f, indent=2)
    print(f"OpenAPI schema successfully written to {output_path}")

if __name__ == "__main__":
    export_openapi()
