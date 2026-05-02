import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.db.init_data import DatabaseInitializer
from app.db.repository import get_data_store
from app.db.supabase_client import get_supabase_client, is_supabase_configured
from app.errors import AppError
from app.routers import api_router
from app.services.rules_config import RulesConfigService
from app.services.runtime_store import get_runtime_store
from app.services.wizard_engine import run_wizard_cleanup_loop

logger = logging.getLogger(__name__)


def initialize_default_data() -> None:
    settings = get_settings()
    store = get_runtime_store()
    if is_supabase_configured(settings):
        client = get_supabase_client()
        repo = get_data_store()
        bootstrap_result = DatabaseInitializer(
            client=client,
            settings=settings,
        ).run()
        RulesConfigService(settings=settings, store=store, repo=repo)
        logger.info(bootstrap_result.message)
        return

    RulesConfigService(settings=settings, store=store)
    logger.info("Supabase is not configured. RuntimeStore defaults are ready.")


@asynccontextmanager
async def lifespan(_: FastAPI):
    cleanup_task = asyncio.create_task(run_wizard_cleanup_loop())
    try:
        initialize_default_data()
        yield
    except Exception:
        logger.exception("Application initialization failed before startup completed.")
        raise
    finally:
        cleanup_task.cancel()
        try:
            await cleanup_task
        except asyncio.CancelledError:
            pass


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        debug=settings.debug,
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["Content-Disposition"],
    )

    @app.exception_handler(AppError)
    async def handle_app_error(_: Request, exc: AppError):
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.message})

    app.include_router(api_router, prefix=settings.api_v1_prefix)
    return app


app = create_app()
