import os
import json

try:
    from supabase import create_client
except ImportError:
    print("supabase not installed")
    exit(1)

url = ""
key = ""
env_path = os.path.join("backend", ".env")
if os.path.exists(env_path):
    with open(env_path, "r") as f:
        for line in f:
            line = line.strip()
            if line.startswith("SUPABASE_URL="):
                url = line.split("=", 1)[1].strip("\"'")
            elif line.startswith("SUPABASE_KEY="):
                key = line.split("=", 1)[1].strip("\"'")

if not url or not key:
    print("No Supabase credentials found.")
    exit(1)

try:
    sb = create_client(url, key)
    sb.table('team_members').delete().neq('id', -1).execute()
    print('Cleared Supabase team_members.')
except Exception as e:
    print('Supabase Error:', e)
