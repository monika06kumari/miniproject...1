# Nexus AI Project

This project contains a Python backend (FastAPI) and a pure HTML/JS frontend.

## Features
- **FastAPI Backend:** Secure, fast REST API.
- **AI Agent Integration:** Connects with Google Gemini using `google-genai`.
- **Database:** Uses Supabase for data storage (with a local JSON fallback).
- **Security:** Built-in rate limiting, sanitized inputs, and secure PBKDF2 password hashing.

---

## 🚀 Setup Instructions

### 1. Prerequisites
- Python 3.9+
- A [Supabase](https://supabase.com/) account (Free tier is fine)
- A Google Gemini API Key

### 2. Supabase Database Setup
1. Create a new project in Supabase.
2. Go to the SQL Editor in your Supabase dashboard.
3. Open the `database/schema.sql` file from this project.
4. Copy the entire contents of `schema.sql` and paste it into the Supabase SQL Editor.
5. Click **Run** to execute the script. This will create all the necessary tables (`team_members`, `projects`, `tasks`, `activity`) with the correct columns and default policies.

### 3. Backend Setup (Local Development)
1. Navigate to the backend directory:
   ```bash
   cd backend
   ```
2. Create a virtual environment and activate it:
   ```bash
   python -m venv venv
   # On Windows:
   venv\Scripts\activate
   # On Mac/Linux:
   source venv/bin/activate
   ```
3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
4. Setup environment variables:
   - Rename `.env.example` to `.env` (or create a `.env` file if it doesn't exist).
   - Fill in your actual API keys:
     ```env
     SUPABASE_URL=your_supabase_project_url
     SUPABASE_KEY=your_supabase_anon_key
     GEMINI_API_KEY=your_gemini_api_key
     ```
5. Run the server:
   ```bash
   py main.py
   # OR
   uvicorn main:app --reload
   ```
   The backend will start on `http://localhost:8000`.

### 4. Frontend Setup
1. Open `app.js` and ensure the `API` constant on line 5 points to your backend URL:
   ```javascript
   const API = 'http://localhost:8000/api';
   ```
2. Open `index.html` directly in your browser, or use a local server like Live Server (VS Code Extension).
3. Click "Create Account" on the login page to register your admin user. Your dashboard will start fresh and clean!

---

## 🔒 Security Notes for Production
- **Environment Variables:** Never commit `.env` to GitHub. It is securely ignored by the `.gitignore` file.
- **Passwords:** Passwords are hashed using PBKDF2 before storage. They are never stored in plain text.
- **Rate Limiting:** The backend automatically blocks IPs that attempt to spam the login endpoint.
- **CORS:** When hosting the backend, ensure the `allow_origins` in `main.py` matches your frontend domain if you want to restrict access.
