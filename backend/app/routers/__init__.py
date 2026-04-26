from fastapi import APIRouter

from . import audit, auth, files, health, rules, settings, templates, wizard

api_router = APIRouter()
api_router.include_router(health.router, tags=["health"])
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(audit.router, prefix="/audit", tags=["audit"])
api_router.include_router(files.router, prefix="/files", tags=["files"])
api_router.include_router(rules.router, prefix="/rules", tags=["rules"])
api_router.include_router(settings.router, prefix="/settings", tags=["settings"])
api_router.include_router(templates.router, prefix="/templates", tags=["templates"])
api_router.include_router(wizard.router, prefix="/wizard", tags=["wizard"])
