# Nexus AI Project

This project contains a Python backend (FastAPI) and a pure HTML/JS frontend.

## Features
- **FastAPI Backend:** Secure, fast REST API.
- **AI Agent Integration:** Connects with Google Gemini using `google-genai`.
- **Database:** Uses Supabase for data storage (with a local JSON fallback).
- **Security:** Built-in rate limiting, sanitized inputs, and secure PBKDF2 password hashing.

---

## 🚀 Setup Instructions

### 1. Backend Setup (Local Development)

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
   - Rename `.env.example` to `.env`
   - Fill in your actual `SUPABASE_URL`, `SUPABASE_KEY`, and `GEMINI_API_KEY`.
5. Run the server:
   ```bash
   uvicorn main:app --reload
   ```
   The backend will start on `http://localhost:8000`.

### 2. Frontend Setup

1. Open `app.js` and ensure the `API` constant on line 5 points to your backend URL (e.g. `http://localhost:8000/api` for local development, or your hosted URL in production).
2. You can open `index.html` directly in your browser, or use a local server like Live Server (VS Code Extension).

---

## 🔒 Security Notes for Production
- **Environment Variables:** Never commit `.env` to GitHub. It is securely ignored by the `.gitignore` file.
- **Passwords:** Passwords are hashed using PBKDF2 before storage. They are never stored in plain text.
- **Rate Limiting:** The backend automatically blocks IPs that attempt to spam the login endpoint.
- **CORS:** When hosting the backend, ensure the `allow_origins` in `main.py` matches your frontend domain if you want to restrict access.
