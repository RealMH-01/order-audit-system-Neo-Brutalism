# Order Audit System Neo-Brutalism

AI-assisted document audit system for trade order follow-up teams, rebuilt as a frontend-backend separated application with a Neo-Brutalism UI foundation.

## Tech Stack

### Backend
- Python 3.11
- FastAPI
- asyncio
- openai / zhipuai / tiktoken
- pdfplumber / python-docx / openpyxl / Pillow / pdf2image
- Supabase (PostgreSQL + Auth)

### Frontend
- Next.js 14 (App Router)
- TypeScript
- Tailwind CSS
- shadcn/ui-compatible component structure
- React Context + useReducer
- lucide-react

### Deployment Targets
- Supabase
- Render
- Vercel

## Project Structure

```text
.
|-- backend/
|   |-- app/
|   |   |-- routers/
|   |   |-- db/
|   |   |-- models/
|   |   |-- config.py
|   |   |-- dependencies.py
|   |   `-- services/
|   |-- requirements.txt
|   |-- Dockerfile
|   |-- packages.txt
|   |-- render.yaml
|   `-- .env.example
|-- frontend/
|   |-- public/
|   |-- src/
|   |   |-- app/
|   |   |-- components/
|   |   |-- lib/
|   |   |-- styles/
|   |   `-- types/
|   |-- package.json
|   `-- .env.example
|-- .env.example
`-- README.md
```

## Local Development

### Backend
1. Create a virtual environment with Python 3.11.
2. Install dependencies:

   ```bash
   cd backend
   pip install -r requirements.txt
   ```

3. Copy environment file:

   ```bash
   cp .env.example .env
   ```

4. Start the API:

   ```bash
   uvicorn app.main:app --reload
   ```

### Frontend
1. Install dependencies:

   ```bash
   cd frontend
   npm install
   ```

2. Copy environment file:

   ```bash
   cp .env.example .env.local
   ```

3. Start the web app:

   ```bash
   npm run dev
   ```

## Deployment

- Backend Render baseline config lives in `backend/render.yaml`.
- Frontend is prepared for Vercel deployment.
- Persistence and authentication target Supabase.

## Current Scope

This repository currently contains an aligned project skeleton for the first two rounds:
- backend module boundary alignment
- frontend `src/` structure alignment
- environment examples
- deployment baseline files
- placeholder routers and services for future rounds

Business workflows such as authentication, file parsing, audit orchestration, OCR routing, and database schema rollout are intentionally deferred to later rounds.
