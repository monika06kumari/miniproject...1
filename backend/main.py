import os
import re
import hashlib
import hmac
import secrets
import time
from collections import defaultdict
from datetime import datetime
from fastapi import FastAPI, HTTPException, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, validator
from typing import Optional, List
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

# ─── Security Utilities ───────────────────────────────────────────────────────

def hash_password(password: str) -> str:
    """Hash a password using PBKDF2-HMAC-SHA256 with a random salt."""
    salt = secrets.token_hex(16)
    hashed = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt.encode('utf-8'), 260000)
    return f"pbkdf2:{salt}:{hashed.hex()}"

def verify_password(plain: str, stored: str) -> bool:
    """Constant-time password verification. Handles both hashed and legacy plaintext."""
    if not stored:
        return False
    if stored.startswith('pbkdf2:'):
        try:
            _, salt, stored_hash = stored.split(':', 2)
            new_hash = hashlib.pbkdf2_hmac('sha256', plain.encode('utf-8'), salt.encode('utf-8'), 260000)
            return hmac.compare_digest(new_hash.hex(), stored_hash)
        except Exception:
            return False
    # Legacy plaintext fallback (migrates on next login)
    return hmac.compare_digest(plain, stored)

# ─── Rate Limiting ────────────────────────────────────────────────────────────
_login_attempts: dict = defaultdict(list)

def check_login_rate_limit(client_ip: str) -> bool:
    """Allow max 10 login attempts per IP per minute. Returns False if blocked."""
    now = time.time()
    window = 60
    max_attempts = 10
    
    # Filter out old attempts for the current IP
    _login_attempts[client_ip] = [t for t in _login_attempts[client_ip] if now - t < window]
    
    # Check if rate limit exceeded
    if len(_login_attempts[client_ip]) >= max_attempts:
        return False
        
    # Add new attempt
    _login_attempts[client_ip].append(now)
    
    # SECURITY FIX: Memory Leak Prevention
    # If the dictionary grows too large (e.g. DoS attack with many IPs), clean up all inactive IPs
    if len(_login_attempts) > 1000:
        for ip in list(_login_attempts.keys()):
            _login_attempts[ip] = [t for t in _login_attempts[ip] if now - t < window]
            if not _login_attempts[ip]:
                del _login_attempts[ip]
                
    return True

# ─── Session Management ───────────────────────────────────────────────────────
_active_sessions: dict = {}  # token -> {email, role, name, created}

def create_session(email: str, role: str, name: str) -> str:
    token = secrets.token_urlsafe(40)
    _active_sessions[token] = {'email': email, 'role': role, 'name': name, 'created': time.time()}
    # Prune expired sessions (8-hour TTL)
    _expire_sessions()
    return token

def _expire_sessions():
    now = time.time()
    expired = [t for t, s in _active_sessions.items() if now - s['created'] > 8 * 3600]
    for t in expired:
        del _active_sessions[t]

def get_session(token: str) -> Optional[dict]:
    session = _active_sessions.get(token)
    if not session:
        return None
    if time.time() - session['created'] > 8 * 3600:
        del _active_sessions[token]
        return None
    return session

_bearer = HTTPBearer(auto_error=False)

def require_auth(credentials: HTTPAuthorizationCredentials = Depends(_bearer)) -> dict:
    """FastAPI dependency: requires a valid session token in Authorization header."""
    if not credentials:
        raise HTTPException(status_code=401, detail="Authentication required")
    session = get_session(credentials.credentials)
    if not session:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    return session

def require_admin(session: dict = Depends(require_auth)) -> dict:
    """FastAPI dependency: requires admin role."""
    if session.get('role') != 'admin':
        raise HTTPException(status_code=403, detail="Admin access required")
    return session

# ─── Input Sanitization ───────────────────────────────────────────────────────
def sanitize_str(value: str, max_len: int = 200) -> str:
    """Strip control characters and limit length."""
    if not value:
        return ""
    # Remove control chars (keep printable unicode)
    cleaned = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', value)
    return cleaned[:max_len].strip()

# ─── Database Setup ───────────────────────────────────────────────────────────
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")

supabase: Client = None
if SUPABASE_URL and SUPABASE_KEY:
    try:
        supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
        print("[OK] Supabase connected.")
    except Exception as e:
        print(f"[WARN] Supabase init failed: {e}")
else:
    print("[WARN] Supabase credentials not found in .env")

# ─── App ──────────────────────────────────────────────────────────────────────
_dev_mode = os.environ.get("NEXUS_DEV", "true").lower() == "true"
app = FastAPI(
    title="Nexus AI Backend",
    version="3.0.0",
    docs_url="/docs" if _dev_mode else None,   # Disable /docs in production
    redoc_url="/redoc" if _dev_mode else None,
)

# Restrict CORS: allow all origins for hosted environment
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Gemini Agentic Setup ─────────────────────────────────────────────────────
gemini_client = None

NEXUS_TOOLS = [
    {
        "function_declarations": [
            {"name": "get_project_status", "description": "Get status and progress of all active projects.", "parameters": {"type": "object", "properties": {}, "required": []}},
            {"name": "get_team_status", "description": "Get capacity, tasks, and status of all active team members.", "parameters": {"type": "object", "properties": {}, "required": []}},
            {"name": "get_risks", "description": "Get all active project risks and blockers.", "parameters": {"type": "object", "properties": {}, "required": []}},
            {"name": "generate_report", "description": "Generate a comprehensive status report of the whole project.", "parameters": {"type": "object", "properties": {}, "required": []}},
            {
                "name": "add_project",
                "description": "Create a new project. ADMIN ONLY.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string", "description": "Project Name"},
                        "description": {"type": "string", "description": "Description"},
                        "color": {"type": "string", "description": "Color Theme (e.g. Indigo, Emerald, Rose)"},
                        "deadline": {"type": "string", "description": "Deadline e.g. Sep 1, 2026"},
                        "meeting_details": {"type": "string", "description": "Meeting Link"},
                        "meeting_time": {"type": "string", "description": "Meeting Time"}
                    },
                    "required": ["name", "description", "color", "deadline", "meeting_details", "meeting_time"]
                }
            },
            {
                "name": "add_member",
                "description": "Add a new team member. ADMIN ONLY.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string", "description": "Full Name"},
                        "email": {"type": "string", "description": "Email ID"},
                        "password": {"type": "string", "description": "Password"},
                        "role": {"type": "string", "description": "Role / Title (e.g. Backend Engineer)"},
                        "position": {"type": "string", "description": "Position (e.g. Team Member, Manager)"},
                        "avatar_bg": {"type": "string", "description": "Avatar Color (e.g. Indigo, Red)"}
                    },
                    "required": ["name", "email", "password", "role", "position", "avatar_bg"]
                }
            },
            {
                "name": "create_task",
                "description": "Create a task on the Kanban board.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string", "description": "Task title"},
                        "project": {"type": "string", "description": "Project to assign to"},
                        "assignee": {"type": "string", "description": "Team member name"},
                        "priority": {"type": "string", "description": "Priority (low/medium/high/critical)"}
                    },
                    "required": ["title", "project", "assignee", "priority"]
                }
            },
            {
                "name": "remove_member",
                "description": "Soft-delete a team member to the Vault. ADMIN ONLY.",
                "parameters": {
                    "type": "object",
                    "properties": {"name": {"type": "string", "description": "Member name to remove"}},
                    "required": ["name"]
                }
            },
            {
                "name": "join_meeting",
                "description": "Simulates joining a project meeting, transcribing it, and summarizing notes and action items.",
                "parameters": {
                    "type": "object",
                    "properties": {"project_name": {"type": "string", "description": "Name of the project meeting to join"}},
                    "required": ["project_name"]
                }
            }
        ]
    }
]

NEXUS_SYSTEM_PROMPT = """You are Nexus AI, an intelligent Chief Operating Officer embedded in the Nexus AI Operations Dashboard.

STRICT RULES:
1. You CANNOT access the internet or external resources. You operate ONLY within Nexus.
2. BE EXTREMELY VERSATILE, FRIENDLY AND CONVERSATIONAL! You must act like a real-world, highly capable AI assistant that can engage in both professional project management and casual conversation. If the user asks a general knowledge question, tells a joke, or says a casual greeting, respond naturally, humorously, or empathetically without using any tools! Use the chat history to follow up naturally.
3. For project-related queries, use the provided tools to fetch live data before answering. Never fabricate project names or team members.
4. You can join meetings using the `join_meeting` tool if the user asks you to join a meeting or take meeting notes for a project.
4. RBAC is CRITICAL: members cannot add_project, add_member, or remove_member. Check the user_role in the conversation and refuse if needed.
5. MISSING DATA HANDLING: If the user asks to create something, you MUST ask for all required fields in the exact format:
   - For a Member: Full Name, Email ID, Password, Role / Title, Position, Avatar Color.
   - For a Project: Project Name, Description, Color Theme, Deadline, Meeting Link, Meeting Time.
   - For a Task: Task title, Project, Assignee, Priority.
   DO NOT call the tool and DO NOT invent the data. Instead, explicitly state what information is missing and provide the exact list of required fields.
6. Be concise, friendly, and actionable. Use HTML: <strong> for bold, <br>• for bullets.
7. When you mutate data, tell the user what was done and that the UI will refresh automatically."""

def init_gemini(api_key=None):
    global gemini_client
    key = api_key or os.environ.get("GEMINI_API_KEY", "")
    if key and key not in ("", "your-gemini-key-here"):
        try:
            from google import genai
            from google.genai import types
            client = genai.Client(api_key=key)
            # Store client and tools config
            gemini_client = {"client": client, "key": key}
            print("[OK] Nexus Agentic AI (google.genai) activated.")
            return True
        except Exception as e:
            print(f"[WARN] Gemini init failed: {e}")
    else:
        print("[INFO] GEMINI_API_KEY not set. Using smart fallback responses.")
    return False

init_gemini()


# ─── Models ───────────────────────────────────────────────────────────────────
class ChatMessage(BaseModel):
    message: str
    conversation_history: Optional[list] = []
    user_role: Optional[str] = "admin"
    user_name: Optional[str] = "Admin"

class LoginRequest(BaseModel):
    email: str
    password: str

class NotificationCreate(BaseModel):
    title: str
    message: str
    iconClass: str
    iconBg: str
    iconColor: str
    roles: List[str] = ["all"]

class TaskUpdate(BaseModel):
    assignee: Optional[str] = None
    status: Optional[str] = None

class TaskCreate(BaseModel):
    title: str
    project: str = "Omega Platform"
    assignee: str = "Alex"
    status: str = "todo"
    priority: str = "medium"
    deadline: Optional[str] = "TBD"

class ProjectCreate(BaseModel):
    name: str
    description: str
    color: str = "#6366f1"
    deadline: Optional[str] = "TBD"
    meeting_details: Optional[str] = ""
    meeting_time: Optional[str] = ""

class ProjectUpdate(BaseModel):
    deadline: Optional[str] = None
    meeting_details: Optional[str] = None
    meeting_time: Optional[str] = None

class TeamMemberCreate(BaseModel):
    name: str
    role: str
    email: Optional[str] = ""
    password: Optional[str] = ""
    position: Optional[str] = "member"
    avatar_bg: str = "#6366f1"

class TeamMemberUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    email: Optional[str] = None
    password: Optional[str] = None
    position: Optional[str] = None
    avatar_bg: Optional[str] = None


# ─── Static Data ──────────────────────────────────────────────────────────────
AGENTS = [
    {"id":"planner","name":"The Strategist","role":"planner","task":"Re-allocating Sprint 4 tasks due to Sarah's Friday PTO.","status":"Active","icon":"ri-node-tree","last_action":"Adjusted 3 task deadlines"},
    {"id":"sentinel","name":"The Sentinel","role":"sentinel","task":"Monitoring PR velocity & Slack sentiment for #proj-omega.","status":"Active","icon":"ri-radar-line","last_action":"Flagged AUTH-402 delay risk"},
    {"id":"executor","name":"The Executor","role":"executor","task":"Drafting weekly stakeholder update email.","status":"Idle","icon":"ri-flashlight-line","last_action":"Sent 2 task reminders"},
    {"id":"scribe","name":"The Scribe","role":"scribe","task":"Transcribed Monday all-hands. Extracted 6 action items.","status":"Idle","icon":"ri-quill-pen-line","last_action":"Summarized Zoom call #2847"},
]
RISKS = [
    {"id":1,"title":"Backend API Delay Predicted","time":"10 mins ago","desc":"AUTH-402 will likely miss Thursday's deadline by ~2 days based on PR velocity.","severity":"high","actionText":"Adjust Timeline","project":"Omega Platform"},
    {"id":2,"title":"Meeting Overload — Frontend Team","time":"1 hour ago","desc":"Alice & Bob have 15+ hours of meetings, reducing dev capacity by 38%.","severity":"medium","actionText":"Cancel Syncs","project":"Atlas App"},
    {"id":3,"title":"PTO Coverage Gap","time":"2 hours ago","desc":"Sarah is out Friday. UI-198 has no backup reviewer assigned.","severity":"medium","actionText":"Reassign Task","project":"Mercury Dashboard"},
]
NOTIFICATIONS = []
# PROJECTS removed, now using Supabase table
import json

TEAM_FILE = os.path.join(os.path.dirname(__file__), "db_team.json")
def load_team():
    if os.path.exists(TEAM_FILE):
        with open(TEAM_FILE, "r") as f:
            return json.load(f)
    return [
        {"name":"Alice","role":"Frontend Engineer","avatar_bg":"#6366f1","capacity":90,"tasks":8,"status":"overloaded"},
        {"name":"Bob","role":"Backend Engineer","avatar_bg":"#0ea5e9","capacity":75,"tasks":6,"status":"healthy"},
        {"name":"Sarah","role":"UI/UX Designer","avatar_bg":"#f43f5e","capacity":60,"tasks":4,"status":"pto_friday"},
        {"name":"Alex","role":"Full-Stack Engineer","avatar_bg":"#10b981","capacity":85,"tasks":7,"status":"healthy"},
    ]

def save_team(team_data):
    with open(TEAM_FILE, "w") as f:
        json.dump(team_data, f, indent=2)

TEAM = load_team()

# ─── Endpoints ────────────────────────────────────────────────────────────────

class ApiKeyUpdate(BaseModel):
    key: str
    model: Optional[str] = "gemini-1.5-flash"

@app.post("/api/settings/api-key")
async def update_api_key(payload: ApiKeyUpdate, session: dict = Depends(require_admin)):
    """
    Updates the API key for the current runtime session.
    SECURITY FIX: We intentionally DO NOT write this to the .env file on disk.
    Modifying server files via an API is a critical security vulnerability and 
    will crash in read-only production environments (like Render/Heroku).
    """
    # 1. Update the environment variable for the current running app
    os.environ["GEMINI_API_KEY"] = payload.key
    
    # 2. Re-initialize the Gemini client with the new key
    success = init_gemini(api_key=payload.key)
    
    if not success:
        return {"success": False, "message": "Failed to initialize Gemini with this key."}
        
    return {
        "success": True, 
        "message": "API key updated for current session. (Note: If hosting on Render/Heroku, update your dashboard Environment Variables to make this permanent.)"
    }

@app.get("/api/agents")
async def get_agents(): return AGENTS

@app.get("/api/risks")
async def get_risks():
    projects = await get_projects()
    active_projects = [p for p in projects if p.get('progress', 0) < 100 and p.get('status') != 'on_track']
    dynamic_risks = []
    
    for i, p in enumerate(active_projects):
        dynamic_risks.append({
            "id": i + 1,
            "title": f"Project At Risk: {p.get('name')}",
            "time": "Just now",
            "desc": f"Progress is at {p.get('progress', 0)}% and status is {p.get('status', 'delayed').replace('_', ' ')}. Expected completion may be delayed.",
            "severity": "high" if p.get('status') == 'at_risk' else "medium",
            "actionText": "Review Timeline",
            "project": p.get('name')
        })

    # Also add risks for any blocked tasks
    if supabase:
        try:
            blocked_tasks_res = supabase.table('tasks').select('*').eq('status', 'blocked').execute()
            for t in blocked_tasks_res.data:
                dynamic_risks.append({
                    "id": len(dynamic_risks) + 1,
                    "title": f"Blocked Task in {t.get('project')}",
                    "time": "Active",
                    "desc": f"Task '{t.get('title')}' assigned to {t.get('assignee')} is currently blocked.",
                    "severity": "high",
                    "actionText": "Unblock Task",
                    "project": t.get('project')
                })
        except Exception:
            pass

    return dynamic_risks

@app.get("/api/projects")
async def get_projects():
    if not supabase: return []
    try:
        p_res = supabase.table('projects').select('*').eq('active', True).execute()
        projects = p_res.data
    except Exception:
        # Fallback if DB doesn't have active column yet
        p_res = supabase.table('projects').select('*').execute()
        projects = [p for p in p_res.data if p.get('active', True)]
    
    t_res = supabase.table('tasks').select('project,status,assignee').execute()
    tasks = t_res.data
    
    for p in projects:
        p_tasks = [t for t in tasks if t['project'] == p['name']]
        p['tasks_total'] = len(p_tasks)
        p['tasks_done'] = len([t for t in p_tasks if t['status'] == 'done'])
        p['team'] = list(set([t['assignee'] for t in p_tasks]))
        if p['tasks_total'] > 0:
            weights = {'todo': 0, 'blocked': 0, 'in_progress': 50, 'review': 75, 'done': 100}
            total_score = sum([weights.get(t['status'], 0) for t in p_tasks])
            p['progress'] = int(total_score / p['tasks_total'])
        else:
            p['progress'] = 0
            
    return projects

@app.post("/api/projects")
async def create_project(proj: ProjectCreate, session: dict = Depends(require_admin)):
    if not supabase: return {"success": False}
    # Create a guaranteed unique ID using the name prefix and a timestamp
    base_id = re.sub(r'[^a-z0-9]', '', proj.name.lower())[:8]
    time_suffix = str(int(datetime.utcnow().timestamp() * 1000))[-6:]
    proj_id = f"{base_id}_{time_suffix}"
    
    payload = {
        "id": proj_id,
        "name": proj.name,
        "description": proj.description,
        "color": proj.color,
        "progress": 0,
        "status": "on_track",
        "deadline": proj.deadline,
        "meeting_details": proj.meeting_details,
        "meeting_time": proj.meeting_time,
        "active": True
    }
    try:
        supabase.table('projects').insert(payload).execute()
        return {"success": True, **payload}
    except Exception:
        return {"success": False, "message": "Failed to create project. Please try again."}

@app.delete("/api/projects/{project_id}")
async def delete_project(project_id: str, session: dict = Depends(require_admin)):
    if not supabase: return {"success": False}
    # Soft delete instead of hard delete
    try:
        now = datetime.utcnow().isoformat()
        supabase.table('projects').update({"active": False, "deleted_at": now}).eq('id', project_id).execute()
        return {"success": True, "message": "Project moved to vault"}
    except Exception as e:
        return {"success": False, "message": str(e)}

@app.patch("/api/projects/{project_id}")
async def update_project(project_id: str, update: ProjectUpdate, session: dict = Depends(require_auth)):
    if not supabase: return {"success": False}
    payload = {}
    if update.deadline is not None: payload['deadline'] = update.deadline
    if update.meeting_details is not None: payload['meeting_details'] = update.meeting_details
    if update.meeting_time is not None: payload['meeting_time'] = update.meeting_time
    if payload:
        try:
            supabase.table('projects').update(payload).eq('id', project_id).execute()
        except Exception as e:
            return {"success": False, "message": str(e)}
    return {"success": True}

@app.get("/api/team")
async def get_team():
    if not supabase: return [m for m in TEAM if m.get('active', True)]
    try:
        res = supabase.table('team_members').select('*').eq('active', True).execute()
        if res.data: return res.data
    except:
        pass
    return [m for m in TEAM if m.get('active', True)]

@app.post("/api/login")
async def login_user(req: LoginRequest, request: Request):
    client_ip = request.headers.get("X-Forwarded-For", request.client.host if request.client else "unknown")

    # Rate limiting: max 10 attempts per IP per minute
    if not check_login_rate_limit(client_ip):
        raise HTTPException(status_code=429, detail="Too many login attempts. Please wait 60 seconds.")

    # Read credentials from environment (never hardcoded)
    admin_email = os.environ.get("NEXUS_ADMIN_EMAIL", "admin@nexus.ai")
    admin_password_hash = os.environ.get("NEXUS_ADMIN_PASS_HASH", "")

    # Constant-time check for default admin (supports both hashed and legacy env value)
    if req.email == admin_email:
        # If no hash set in env, check against legacy plaintext env var
        admin_plain = os.environ.get("NEXUS_ADMIN_PASS", "")
        if (admin_password_hash and verify_password(req.password, admin_password_hash)) or \
           (admin_plain and hmac.compare_digest(req.password, admin_plain)):
            token = create_session(admin_email, "admin", "Admin User")
            return {"name": "Admin User", "email": admin_email, "role": "admin", "token": token}

    # Check team members (with automatic password migration to hashed format)
    for m in TEAM:
        if m.get("email") == req.email and m.get("active", True):
            stored_pw = m.get("password", "")
            if verify_password(req.password, stored_pw):
                # Migrate plaintext → hashed on successful login
                if stored_pw and not stored_pw.startswith("pbkdf2:"):
                    m["password"] = hash_password(req.password)
                    save_team(TEAM)
                role = m.get("position", "member")
                name = m.get("name", "User")
                token = create_session(req.email, role, name)
                return {"name": name, "email": req.email, "role": role, "token": token}

    # Generic error — do not hint whether email or password was wrong
    raise HTTPException(status_code=401, detail="Invalid email or password")

@app.post("/api/team")
async def add_team_member(member: TeamMemberCreate, session: dict = Depends(require_admin)):
    if member.email:
        if any(m.get('email') == member.email for m in TEAM):
            return {"success": False, "error": "A user with this email already exists."}
        if supabase:
            try:
                res = supabase.table('team_members').select('*').eq('email', member.email).execute()
                if res.data:
                    return {"success": False, "error": "A user with this email already exists."}
            except Exception:
                pass
    
    if not supabase: return {"success": False, "error": "No database"}

    # Hash the password before storing — never store plaintext
    hashed_pw = hash_password(member.password) if member.password else ""

    payload = {
        "name": sanitize_str(member.name, 100),
        "role": sanitize_str(member.role, 100),
        "avatar_bg": member.avatar_bg,
        "capacity": 0,
        "tasks": 0,
        "status": "healthy",
        "active": True,
        "email": member.email
    }
    try:
        supabase.table('team_members').insert(payload).execute()
        # Store hashed password in local team file (supabase should handle auth separately)
        local_payload = {**payload, "password": hashed_pw, "position": member.position or "member"}
        TEAM.append(local_payload)
        save_team(TEAM)
        return {"success": True, **payload}  # Never return password hash in response
    except Exception:
        local_payload = {**payload, "password": hashed_pw, "position": member.position or "member"}
        TEAM.append(local_payload)
        save_team(TEAM)
        return {"success": True, **payload}

@app.delete("/api/team/{member_name}")
async def remove_team_member(member_name: str, session: dict = Depends(require_admin)):
    # Soft delete — keeps all task history intact
    if supabase:
        try:
            supabase.table('team_members').update({"active": False}).eq('name', member_name).execute()
        except:
            pass
    # Also remove from in-memory fallback
    global TEAM
    for m in TEAM:
        if m['name'] == member_name:
            m['active'] = False
    save_team(TEAM)
    return {"success": True}

@app.patch("/api/team/{identifier}")
async def update_team_member(identifier: str, member: TeamMemberUpdate, session: dict = Depends(require_auth)):
    # If not admin, they can only edit their own profile
    is_admin = session.get('role') == 'admin'
    target_email = identifier

    # Check permission
    if not is_admin and session.get('email') != target_email:
        raise HTTPException(status_code=403, detail="You can only edit your own profile")

    # Intercept admin self-edit to update .env instead of database
    admin_env_email = os.environ.get("NEXUS_ADMIN_EMAIL", "admin@nexus.ai")
    if identifier == admin_env_email or identifier == "Admin User" or identifier == "admin":
        if not is_admin:
            raise HTTPException(status_code=403, detail="Forbidden")
            
        env_path = os.path.join(os.path.dirname(__file__), ".env")
        try:
            with open(env_path, "r") as f:
                env_content = f.read()
        except Exception:
            env_content = ""
            
        updates = member.dict(exclude_unset=True)
        if 'email' in updates and updates['email']:
            if "NEXUS_ADMIN_EMAIL=" in env_content:
                env_content = re.sub(r'NEXUS_ADMIN_EMAIL=.*', f'NEXUS_ADMIN_EMAIL="{updates["email"]}"', env_content)
            else:
                env_content += f'\nNEXUS_ADMIN_EMAIL="{updates["email"]}"\n'
                
            os.environ["NEXUS_ADMIN_EMAIL"] = updates["email"]
                
        if 'password' in updates and updates['password']:
            hashed_pw = hash_password(updates['password'])
            if "NEXUS_ADMIN_PASS_HASH=" in env_content:
                env_content = re.sub(r'NEXUS_ADMIN_PASS_HASH=.*', f'NEXUS_ADMIN_PASS_HASH="{hashed_pw}"', env_content)
            else:
                env_content += f'\nNEXUS_ADMIN_PASS_HASH="{hashed_pw}"\n'
            # Also clear legacy plaintext if it exists
            env_content = re.sub(r'NEXUS_ADMIN_PASS=.*', '', env_content)
            os.environ["NEXUS_ADMIN_PASS_HASH"] = hashed_pw
            os.environ.pop("NEXUS_ADMIN_PASS", None)
                
        with open(env_path, "w") as f:
            f.write(env_content)
            
        return {"success": True, "message": "Admin profile updated in .env"}

    global TEAM
    target_idx = -1
    for i, m in enumerate(TEAM):
        # Allow identifying by email or name fallback
        if m.get('email') == identifier or m.get('name') == identifier:
            target_idx = i
            break
            
    if target_idx == -1:
        raise HTTPException(status_code=404, detail="Member not found")
        
    m = TEAM[target_idx]
    
    updates = member.dict(exclude_unset=True)
    
    # Hash password if it is being updated
    if 'password' in updates and updates['password']:
        updates['password'] = hash_password(updates['password'])
    elif 'password' in updates and not updates['password']:
        del updates['password']
        
    for k, v in updates.items():
        m[k] = sanitize_str(v, 200) if isinstance(v, str) and k != 'password' else v
        
    TEAM[target_idx] = m
    save_team(TEAM)
    
    # Update Supabase if available
    if supabase and m.get('email'):
        try:
            db_updates = {k: v for k, v in updates.items() if k != 'password'}
            if db_updates:
                supabase.table('team_members').update(db_updates).eq('email', m.get('email')).execute()
        except Exception:
            pass
            
    return {"success": True}

# ─── Vault Endpoints ──────────────────────────────────────────────────────────
@app.get("/api/vault/projects")
async def get_vault_projects():
    if not supabase: return []
    try:
        res = supabase.table('projects').select('*').eq('active', False).execute()
        return res.data
    except:
        return []

@app.post("/api/projects/{project_id}/restore")
async def restore_project(project_id: str, session: dict = Depends(require_admin)):
    if not supabase: return {"success": False}
    try:
        supabase.table('projects').update({"active": True, "deleted_at": None}).eq('id', project_id).execute()
        return {"success": True}
    except Exception as e:
        return {"success": False, "message": str(e)}

@app.get("/api/vault/team")
async def get_vault_team():
    if not supabase: return [m for m in TEAM if not m.get('active', True)]
    try:
        res = supabase.table('team_members').select('*').eq('active', False).execute()
        return res.data
    except:
        return [m for m in TEAM if not m.get('active', True)]

@app.post("/api/team/{member_name}/restore")
async def restore_team_member(member_name: str, session: dict = Depends(require_admin)):
    if supabase:
        try:
            supabase.table('team_members').update({"active": True}).eq('name', member_name).execute()
        except:
            pass
            
    global TEAM
    for m in TEAM:
        if m['name'] == member_name:
            m['active'] = True
    save_team(TEAM)
    return {"success": True}

@app.get("/api/stats")
async def get_stats():
    projects = await get_projects()
    active_projects = len([p for p in projects if p.get('progress', 0) < 100])
    risks = await get_risks()
    return {"active_projects":active_projects,"team_capacity":82,"active_risks":len(risks),"tasks_completed_today":5,"upcoming_deadlines":2}

@app.get("/api/tasks")
async def get_tasks(project: Optional[str] = None):
    if not supabase: return []
    query = supabase.table('tasks').select('*')
    if project:
        query = query.eq('project', project)
    res = query.execute()
    return res.data

@app.patch("/api/tasks/{task_id}")
async def update_task(task_id: int, update: TaskUpdate, session: dict = Depends(require_auth)):
    if not supabase: return {"success": False}
    payload = {}
    if update.assignee: payload['assignee'] = update.assignee
    if update.status: payload['status'] = update.status
    if payload:
        supabase.table('tasks').update(payload).eq('id', task_id).execute()
    return {"success": True, "message": f"Task {task_id} updated"}

@app.post("/api/tasks")
async def create_task(task: TaskCreate, session: dict = Depends(require_auth)):
    if not supabase: return {"success": False}
    payload = {
        "title": task.title, "project": task.project, "assignee": task.assignee,
        "status": task.status, "priority": task.priority, "deadline": task.deadline or "TBD"
    }
    res = supabase.table('tasks').insert(payload).execute()
    new_task = res.data[0] if res.data else payload
    return {"success": True, **new_task}

@app.delete("/api/tasks/{task_id}")
async def delete_task(task_id: int, session: dict = Depends(require_admin)):
    # Admin-only: hard-delete a task from the board
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")
    try:
        supabase.table('tasks').delete().eq('id', task_id).execute()
        return {"success": True, "deleted_id": task_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete task: {str(e)}")

@app.get("/api/activity")
async def get_activity():
    if not supabase: return []
    res = supabase.table('activity').select('*').order('id').execute()
    return res.data

@app.get("/api/notifications")
async def get_notifications():
    import time
    global NOTIFICATIONS
    thirty_days_ago = int(time.time() * 1000) - (30 * 24 * 60 * 60 * 1000)
    NOTIFICATIONS = [n for n in NOTIFICATIONS if n.get('id', 0) > thirty_days_ago]
    return NOTIFICATIONS

@app.post("/api/notifications")
async def create_notification(notif: NotificationCreate, session: dict = Depends(require_auth)):
    import time
    new_notif = notif.dict()
    new_notif['id'] = int(time.time() * 1000)
    NOTIFICATIONS.append(new_notif)
    if len(NOTIFICATIONS) > 50:
        NOTIFICATIONS.pop(0)
    return {"success": True, "notification": new_notif}

@app.get("/api/report")
async def get_report():
    task_stats = {}
    if supabase:
        res = supabase.table('tasks').select('status').execute()
        for t in res.data:
            task_stats[t['status']] = task_stats.get(t['status'], 0) + 1

    return {
        "generated_at": "June 23, 2026 — 12:00 AM",
        "period": "Sprint 4 (Jun 16 – Jul 4)",
        "summary": {
            "projects_on_track": 2,
            "projects_at_risk": 2,
            "team_capacity": 82,
            "tasks_completed_today": 5,
            "velocity": "8 pts/day",
            "velocity_change": "-12% vs last week"
        },
        "task_breakdown": task_stats,
        "top_risks": [r["title"] for r in RISKS],
        "highlights": [
            "Nova API Gateway is 95% complete — launching Friday",
            "Atlas App on track for Jul 30 delivery",
            "AUTH-402 blocked — immediate attention needed",
            "Alice at 90% capacity — recommend offloading 2 tasks"
        ],
        "upcoming_deadlines": [
            {"name": "Nova API Gateway", "date": "Jun 28", "status": "on_track"},
            {"name": "Omega Platform Sprint 4", "date": "Jul 4", "status": "at_risk"},
        ]
    }

@app.get("/api/sprint")
async def get_sprint():
    total, done = 0, 0
    if supabase:
        res = supabase.table('tasks').select('status').execute()
        total = len(res.data)
        done = sum(1 for t in res.data if t['status'] == 'done')

    sprint_days = 19       # Jun 16 – Jul 4
    elapsed = 7
    remaining = total - done
    ideal_rate = total / sprint_days if sprint_days else 1
    actual_rate = done / elapsed if elapsed > 0 else 0
    days_to_finish = (remaining / actual_rate) if actual_rate > 0 else sprint_days
    on_track = days_to_finish <= (sprint_days - elapsed)

    # Build lines (length = elapsed+1 points)
    ideal = [round(total - i * ideal_rate, 1) for i in range(elapsed + 1)]
    actual_vals = [total, total-2, total-4, total-5, total-7, total-9, total-11, total-done]

    return {
        "sprint_name": "Sprint 4",
        "start": "Jun 16", "end": "Jul 4",
        "total_tasks": total, "done": done,
        "remaining": remaining,
        "days_total": sprint_days, "days_elapsed": elapsed,
        "days_left": sprint_days - elapsed,
        "velocity": round(actual_rate, 1),
        "on_track": on_track,
        "predicted_finish": "Jul 3" if on_track else "Jul 6",
        "ideal_line": ideal,
        "actual_line": actual_vals,
        "labels": ["Jun 16","Jun 17","Jun 18","Jun 19","Jun 20","Jun 21","Jun 22","Jun 23"]
    }

# ─── NL Task Parser ───────────────────────────────────────────────────────────
def parse_task_from_nl(message: str):
    msg = message.lower()
    triggers = ["create task","add task","new task","create a task","add a task",
                "make a task","create ticket","add ticket"]
    if not any(t in msg for t in triggers):
        return None

    assignee = next((n.capitalize() for n in ["alice","bob","sarah","alex"] if n in msg), "Alex")

    priority = "medium"
    if any(w in msg for w in ["critical","urgent","blocker"]): priority = "critical"
    elif "high" in msg: priority = "high"
    elif "low" in msg: priority = "low"

    project = "Omega Platform"
    if "atlas" in msg: project = "Atlas App"
    elif "mercury" in msg or "dashboard" in msg: project = "Mercury Dashboard"
    elif "nova" in msg or " api" in msg: project = "Nova API"

    # Extract title: take text after the trigger
    title = message
    for t in triggers:
        if t in msg:
            idx = msg.find(t) + len(t)
            title = message[idx:].strip().lstrip(":- ")
            break

    # Strip noise words
    for kw in [f" assign to {assignee}",f" for {assignee}"," high priority"," low priority",
               " critical"," urgent"," in nova"," in atlas"," in omega"," in mercury",
               " assign to alice"," assign to bob"," assign to sarah"," assign to alex"]:
        title = re.sub(re.escape(kw), "", title, flags=re.IGNORECASE).strip()

    title = title.strip(" ,.")
    if len(title) < 3:
        return None
    return {"title": title[:80], "assignee": assignee, "priority": priority,
            "project": project, "status": "todo", "deadline": "TBD"}

# ─── Chat with Action Detection ───────────────────────────────────────────────
def detect_action(message: str):
    msg = message.lower()
    if any(w in msg for w in ["show project", "open project", "go to project", "project view"]):
        return {"type": "navigate", "view": "projects"}
    if any(w in msg for w in ["kanban", "board", "show board", "task board"]):
        return {"type": "navigate", "view": "kanban"}
    if any(w in msg for w in ["show team", "team workload", "who has bandwidth", "team view"]):
        return {"type": "navigate", "view": "team"}
    if any(w in msg for w in ["show agent", "agent swarm", "agent status"]):
        return {"type": "navigate", "view": "agents"}
    if any(w in msg for w in ["report", "weekly summary", "generate report", "weekly report"]):
        return {"type": "show_report"}
    if "sprint" in msg or "burndown" in msg:
        return {"type": "navigate", "view": "kanban"}
    if "reassign" in msg and "alex" in msg:
        return {"type": "toast", "message": "Task AUTH-402 has been reassigned to Alex", "status": "success"}
    if "cancel" in msg and ("meeting" in msg or "sync" in msg):
        return {"type": "toast", "message": "3 optional syncs cancelled. Team recovered 9 hours.", "status": "success"}
    return None

# ─── AI Tool Executor ─────────────────────────────────────────────────────────
async def execute_tool(tool_name: str, args: dict, user_role: str, user_name: str):
    """Executes a Gemini tool call and returns (result_text, refresh_views_list)."""
    refresh = []

    if tool_name == "get_project_status":
        try:
            if supabase:
                rows = supabase.table("projects").select("name,description,progress,deadline,active,meeting_time,meeting_details").execute()
                projects = rows.data or []
                
                active_projects = [p for p in projects if p.get("active", True) and p.get("progress", 0) < 100]
                completed_projects = [p for p in projects if not p.get("active", True) or p.get("progress", 0) >= 100]
                
                result = f"<strong>Project Stats:</strong><br>• Active Projects: {len(active_projects)}<br>• Completed Projects: {len(completed_projects)}<br><br>"
                result += "<strong>Active Projects Details:</strong><br>" + "<br>".join(
                    [f"• {p['name']}: {p.get('progress',0)}% — Deadline: {p.get('deadline','TBD')}" + 
                     (f" (Upcoming Meeting: {p['meeting_time']} on {p['meeting_details']})" if p.get("meeting_time") else "") 
                     for p in active_projects]
                ) if active_projects else "No active projects."
            else:
                result = "No database connected. Using local data."
        except Exception as e:
            result = f"Error fetching project status: {e}"
        return result, refresh

    if tool_name == "get_team_status":
        active = [m for m in TEAM if m.get('active', True)]
        result = "<strong>Team Status:</strong><br>" + "<br>".join(
            [f"• {m['name']} ({m['role']}): {m.get('capacity',0)}% capacity — {m.get('status','healthy')}" for m in active]
        )
        return result, refresh

    if tool_name == "get_risks":
        result = "<strong>Active Risks:</strong><br>" + "<br>".join(
            [f"• [{r['severity'].upper()}] {r['title']}: {r['desc']}" for r in RISKS]
        )
        return result, refresh

    if tool_name == "generate_report":
        active_team = [m for m in TEAM if m.get('active', True)]
        avg_cap = sum(m.get('capacity', 0) for m in active_team) // max(len(active_team), 1)
        proj_count = 0
        try:
            if supabase:
                proj_count = len(supabase.table("projects").select("id").eq("active", True).execute().data or [])
        except: pass
        result = (f"<strong>Nexus Status Report:</strong><br>"
                  f"• Active Projects: {proj_count}<br>"
                  f"• Team Size: {len(active_team)} members<br>"
                  f"• Avg Team Capacity: {avg_cap}%<br>"
                  f"• Active Risks: {len(RISKS)} ({sum(1 for r in RISKS if r['severity']=='high')} high-severity)")
        return result, refresh

    if tool_name == "add_project":
        if user_role != "admin":
            return "<strong>Permission Denied:</strong> Only admins can add projects.", refresh
        name = args.get("name")
        desc = args.get("description")
        color = args.get("color")
        deadline = args.get("deadline")
        meeting_details = args.get("meeting_details")
        meeting_time = args.get("meeting_time")
        try:
            if supabase:
                supabase.table("projects").insert({
                    "name": name, "description": desc, "progress": 0,
                    "deadline": deadline, "color": color, "active": True,
                    "meeting_details": meeting_details, "meeting_time": meeting_time
                }).execute()
            refresh = ["dashboard", "projects"]
            result = f"<strong><i class='ri-check-line text-green'></i> Project Created!</strong><br>• Name: {name}<br>• Theme: {color}<br>• Deadline: {deadline}<br>• Meeting: {meeting_time} ({meeting_details})<br><br>The dashboard will refresh automatically."
        except Exception as e:
            result = f"<strong>Error creating project:</strong> {e}"
        return result, refresh

    if tool_name == "add_member":
        if user_role != "admin":
            return "<strong>Permission Denied:</strong> Only admins can add team members.", refresh
        name = args.get("name")
        email = args.get("email")
        password = args.get("password")
        role = args.get("role")
        position = args.get("position")
        avatar_bg = args.get("avatar_bg")
        
        new_member = {"name": name, "role": role, "email": email, "position": position,
                      "avatar_bg": avatar_bg, "capacity": 0,
                      "tasks": 0, "status": "healthy", "active": True, "password": password}
        TEAM.append(new_member)
        save_team(TEAM)
        if supabase:
            try:
                supabase.table("team_members").insert({
                    "name": name, "role": role, "email": email, "position": position,
                    "avatar_bg": avatar_bg, "capacity": 0,
                    "tasks": 0, "status": "healthy", "active": True
                }).execute()
            except: pass
        refresh = ["dashboard", "team"]
        result = (f"<strong><i class='ri-check-line text-green'></i> Member Added!</strong><br>"
                  f"• Name: {name}<br>• Email: {email}<br>• Role: {role} ({position})<br>"
                  f"• Credentials have been set. Share login details privately.<br><br>"
                  f"The team page will refresh automatically.")
        return result, refresh

    if tool_name == "create_task":
        title = args.get("title")
        project = args.get("project")
        assignee = args.get("assignee")
        priority = args.get("priority")
        deadline = "TBD"  # Deadline was removed from the UI for quick add
        try:
            if supabase:
                supabase.table("tasks").insert({
                    "title": title, "project": project, "assignee": assignee,
                    "status": "todo", "priority": priority, "deadline": deadline
                }).execute()
            refresh = ["kanban", "dashboard"]
            result = (f"<strong><i class='ri-check-line text-green'></i> Task Created!</strong><br>"
                      f"• Title: {title}<br>• Project: {project}<br>"
                      f"• Assigned to: {assignee}<br>• Priority: {priority.upper()}<br><br>"
                      f"Added to the Kanban board.")
        except Exception as e:
            result = f"<strong>Error creating task:</strong> {e}"
        return result, refresh

    if tool_name == "remove_member":
        if user_role != "admin":
            return "<strong>Permission Denied:</strong> Only admins can remove team members.", refresh
        name = args.get("name", "")
        found = False
        for m in TEAM:
            if m['name'].lower() == name.lower():
                m['active'] = False
                found = True
                break
        if not found:
            return f"Team member '{name}' not found.", refresh
        save_team(TEAM)
        if supabase:
            try: supabase.table("team_members").update({"active": False}).eq("name", name).execute()
            except: pass
        refresh = ["dashboard", "team"]
        result = f"<strong><i class='ri-check-line text-green'></i> Member Removed.</strong><br>'{name}' has been archived to the Vault. The team page will refresh automatically."
        return result, refresh

    if tool_name == "join_meeting":
        project_name = args.get("project_name", "Unknown Project")
        # Simulating joining a meeting and transcribing it
        import asyncio
        await asyncio.sleep(2) # Simulate meeting joining delay
        
        result = (
            f"<strong><i class='ri-mic-line text-accent'></i> Joined Meeting: {project_name}</strong><br>"
            f"I have successfully connected to the meeting and analyzed the transcript.<br><br>"
            f"<strong><i class='ri-file-text-line text-accent'></i> Meeting Notes & Summary:</strong><br>"
            f"• Discussed upcoming deadlines and blocker resolutions.<br>"
            f"• Frontend team confirmed the new UI components are ready.<br>"
            f"• Backend API integration needs more testing.<br><br>"
            f"<strong><i class='ri-focus-2-line text-accent'></i> Action Items:</strong><br>"
            f"• Schedule a follow-up sync with QA next Tuesday.<br>"
            f"• Update the API documentation by Friday.<br><br>"
            f"<em>Notes have been saved to the {project_name} project vault.</em>"
        )
        return result, refresh

    return f"Unknown tool: {tool_name}", refresh


# ─── Chat Endpoint ────────────────────────────────────────────────────────────
@app.post("/api/chat")
async def process_chat(chat: ChatMessage, credentials: HTTPAuthorizationCredentials = Depends(_bearer)):
    # Verify session and get role server-side (never trust client-supplied role)
    session = None
    if credentials:
        session = get_session(credentials.credentials)
    if not session:
        raise HTTPException(status_code=401, detail="Authentication required")

    # Use server-verified role — ignore any role the client sends
    user_role = session.get('role', 'member')
    user_name = session.get('name', 'User')

    # ── Use Gemini Agentic Mode if available ──
    if gemini_client:
        # Models to try in order — highest quality first, fallback on quota errors
        FALLBACK_MODELS = [
            "gemini-2.5-flash",    # 20 req/day free tier (best quality)
            "gemini-2.0-flash",    # 1500 req/day free tier
            "gemini-flash-latest", # alias for latest stable flash
        ]
        
        from google import genai as genai_sdk
        from google.genai import types

        client = gemini_client["client"]

        # Build tools from our NEXUS_TOOLS dict
        fn_decls = NEXUS_TOOLS[0]["function_declarations"]
        tools = [types.Tool(function_declarations=[
            types.FunctionDeclaration(**fd) for fd in fn_decls
        ])]

        config = types.GenerateContentConfig(
            system_instruction=NEXUS_SYSTEM_PROMPT,
            tools=tools,
        )

        contents = []
        if chat.conversation_history:
            for hist_msg in chat.conversation_history:
                role = hist_msg.get("role", "user")
                text = hist_msg.get("text", "")
                if role == "system": continue
                contents.append(types.Content(role=role, parts=[types.Part(text=text)]))
        
        current_time_str = datetime.now().strftime("%A, %B %d, %Y %I:%M %p")
        context_msg = f"[USER CONTEXT] Role: {user_role}, Name: {user_name}.\n[SYSTEM CONTEXT] Current Date/Time: {current_time_str}\nUser Message: {chat.message}"
        contents.append(types.Content(role="user", parts=[types.Part(text=context_msg)]))

        # Try each model until one works
        last_error = None
        active_model = None
        for model_name in FALLBACK_MODELS:
            try:
                # Quick probe to check if model responds (just try first call)
                test = client.models.generate_content(
                    model=model_name,
                    contents=[types.Content(role="user", parts=[types.Part(text="ping")])],
                    config=types.GenerateContentConfig(system_instruction="Reply only: pong")
                )
                active_model = model_name
                print(f"[AI] Using model: {model_name}")
                break
            except Exception as probe_err:
                err_str = str(probe_err)
                if "429" in err_str or "RESOURCE_EXHAUSTED" in err_str or "quota" in err_str.lower():
                    print(f"[WARN] Model {model_name} quota exhausted, trying next...")
                    last_error = probe_err
                    continue
                else:
                    # Non-quota error (e.g. model not found) — try next
                    print(f"[WARN] Model {model_name} failed: {probe_err}")
                    last_error = probe_err
                    continue

        if not active_model:
            return {
                "reply": (
                    "<strong><i class='ri-error-warning-line text-red'></i> AI Quota Reached</strong><br>"
                    "The free tier rate limit for Gemini has been exceeded. Please wait a moment and try again.<br><br>"
                    "<i class='ri-lightbulb-flash-line text-yellow'></i> <strong>To fix this:</strong><br>"
                    "• Wait until your quota resets (midnight Pacific time), OR<br>"
                    "• Upgrade to a paid Gemini API plan for unlimited requests, OR<br>"
                    "• Enter a different API key in <strong>Settings → Integrations</strong>"
                ),
                "ai_powered": False,
                "refresh_required": []
            }

        all_refresh = []
        try:
            # Tool calling loop — up to 5 rounds
            for _ in range(5):
                response = client.models.generate_content(
                    model=active_model,
                    contents=contents,
                    config=config
                )

                # Check for function calls
                fn_calls = [p.function_call for part in (response.candidates[0].content.parts if response.candidates else []) for p in [part] if hasattr(p, 'function_call') and p.function_call]
                
                if fn_calls:
                    # Process all function calls in this round
                    fn_results = []
                    for fc in fn_calls:
                        tool_result, refresh_views = await execute_tool(
                            fc.name, dict(fc.args) if fc.args else {}, user_role, user_name
                        )
                        all_refresh.extend(refresh_views)
                        fn_results.append(types.Part(
                            function_response=types.FunctionResponse(
                                name=fc.name,
                                response={"result": tool_result}
                            )
                        ))
                    # Add model response and function results to history
                    contents.append(response.candidates[0].content)
                    contents.append(types.Content(role="user", parts=fn_results))
                else:
                    # Text response — done!
                    reply_text = response.text or "I've processed your request."
                    return {
                        "reply": reply_text,
                        "ai_powered": True,
                        "refresh_required": list(set(all_refresh))
                    }

            return {"reply": "I processed your request.", "ai_powered": True, "refresh_required": list(set(all_refresh))}

        except Exception as e:
            err_str = str(e)
            print(f"[WARN] Gemini agent error: {e}")
            if "429" in err_str or "RESOURCE_EXHAUSTED" in err_str:
                return {
                    "reply": (
                        "<strong><i class='ri-error-warning-line text-red'></i> AI Quota Reached</strong><br>"
                        f"The model <em>{active_model}</em> hit its daily request limit.<br><br>"
                        "<i class='ri-lightbulb-flash-line text-yellow'></i> <strong>Options:</strong><br>"
                        "• Wait until midnight Pacific time for quota reset, OR<br>"
                        "• Upgrade to a paid Gemini API plan, OR<br>"
                        "• Enter a different API key in <strong>Settings → Integrations</strong>"
                    ),
                    "ai_powered": False,
                    "refresh_required": []
                }
            # Don't leak internal error details to client
            return {
                "reply": "<strong>AI Error:</strong> An error occurred processing your request. Please try again.",
                "ai_powered": False,
                "refresh_required": []
            }

    # ── Smart Keyword Fallback (no Gemini) ──
    msg = chat.message.lower()
    action = detect_action(chat.message)

    # Try NL task creation first
    task_data = parse_task_from_nl(chat.message)
    if task_data:
        if user_role == "member":
            return {"reply": "<strong>Permission Denied:</strong> Members cannot create tasks via chat.", "ai_powered": False, "refresh_required": []}
        if supabase:
            supabase.table('tasks').insert({"title": task_data["title"], "project": task_data["project"],
                "assignee": task_data["assignee"], "status": "todo",
                "priority": task_data["priority"], "deadline": "TBD"}).execute()
        reply = (f'<strong>Task created!</strong><br>• Title: {task_data["title"]}<br>'
                 f'• Project: {task_data["project"]}<br>• Assigned to: {task_data["assignee"]}<br>'
                 f'• Priority: {task_data["priority"].upper()}')
        return {"reply": reply, "ai_powered": False, "refresh_required": ["kanban", "dashboard"]}

    if any(w in msg for w in ["risk","delay","block","problem","issue"]):
        reply = "<strong>2 active risks detected:</strong><br>• AUTH-402 will miss Thursday by ~2 days. Recommend reassigning to Alex.<br>• Sarah's PTO on Friday leaves UI-198 without a reviewer."
    elif any(w in msg for w in ["project","status","progress","overview"]):
        reply = "<strong>Project Health:</strong><br>• Nova API → 95% <i class='ri-check-line text-green'></i><br>• Atlas App → 81% <i class='ri-check-line text-green'></i><br>• Omega Platform → 62% <i class='ri-error-warning-line text-red'></i><br>• Mercury Dashboard → 40% <i class='ri-error-warning-line text-red'></i>"
    elif any(w in msg for w in ["team","workload","capacity","who","bandwidth"]):
        reply = "<strong>Team Status:</strong><br>• Alice: 90% <i class='ri-error-warning-line text-red'></i> Overloaded<br>• Bob: 75% <i class='ri-check-line text-green'></i> Healthy<br>• Sarah: 60% (PTO Fri)<br>• Alex: 85% — best for reassignments"
    elif any(w in msg for w in ["report","summary","weekly"]):
        reply = "<strong>Weekly Report:</strong><br>• 5 tasks done today, 30/48 in Sprint 4<br>• Team velocity: 8 pts/day<br>• 2 risks need attention<br>• Nova API launching Friday!"
    else:
        reply = f"Analyzing your request: <strong>\"{chat.message}\"</strong><br><br>I'll cross-reference this against our 4 active projects and team capacity. What would you like me to do?"

    return {"reply": reply, "ai_powered": False, "action": action, "refresh_required": []}

from fastapi.staticfiles import StaticFiles
import os

# Serve static files from the parent directory (where index.html is)
parent_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
app.mount("/", StaticFiles(directory=parent_dir, html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="localhost", port=8000)
