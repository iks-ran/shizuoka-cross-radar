"""Exercise the archive URLs served by the production preview."""
import json
import sys
import urllib.request

from .history import validate_bundle, validate_index


def main():
    base = sys.argv[1].rstrip("/") + "/data/"
    def read(path):
        with urllib.request.urlopen(base + path, timeout=10) as response:
            return json.load(response)
    index = read("history-index.json")
    validate_index(index)
    for entry in index["dates"]:
        bundle = read(entry["path"])
        validate_bundle(bundle)
        assert bundle["timetable"]["serviceDate"] == entry["serviceDate"]
    print(f"History smoke passed: index and {len(index['dates'])} daily bundles")


if __name__ == "__main__":
    main()
