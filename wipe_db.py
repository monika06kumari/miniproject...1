import os
import sys
import json

# Try importing supabase
try:
    from supabase import create_client
except ImportError:
    print("Cannot import supabase. Please run: pip install supabase")
    sys.exit(1)

# Parse .env manually since dotenv might not be installed
url = ""
key = ""
env_path = os.path.join("backend", ".env")
if os.path.exists(env_path):
    with open(env_path, "r") as f:
        for line in f:
            line = line.strip()
            if line.startswith("SUPABASE_URL="):
                url = line.split("=", 1)[1].strip('"\'')
            elif line.startswith("SUPABASE_KEY="):
                key = line.split("=", 1)[1].strip('"\'')

if not url or not key:
    print("No Supabase credentials found in .env")
    sys.exit(0)

try:
    supabase = create_client(url, key)

    print("Wiping ALL data from Supabase...")

    # Delete ALL team members (not just mock names)
    try:
        supabase.table('team_members').delete().neq('id', -1).execute()
        print("[OK] Deleted all team members")
    except Exception as e:
        print(f"[WARN] team_members: {e}")

    # Delete all projects
    try:
        supabase.table('projects').delete().neq('id', '').execute()
        print("[OK] Deleted all projects")
    except Exception as e:
        print(f"[WARN] projects: {e}")

    # Delete all tasks
    try:
        supabase.table('tasks').delete().neq('id', -1).execute()
        print("[OK] Deleted all tasks")
    except Exception as e:
        print(f"[WARN] tasks: {e}")

    # Delete all activity
    try:
        supabase.table('activity').delete().neq('id', -1).execute()
        print("[OK] Deleted all activity logs")
    except Exception as e:
        print(f"[WARN] activity: {e}")

    # Also clear the local db_team.json
    db_path = os.path.join("backend", "db_team.json")
    with open(db_path, "w") as f:
        json.dump([], f)
    print("[OK] Cleared local db_team.json")

    print("\nAll done! The app is now fully reset.")
    print("You can now sign up as a fresh admin at http://localhost:8000")

except Exception as e:
    print("Fatal error:", e)
