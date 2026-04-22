from fastapi import APIRouter, Depends

from app.dependencies import get_file_parser_service
from app.models.schemas import FileCapability
from app.services.file_parser import FileParserService

router = APIRouter()


@router.get("/capabilities", response_model=FileCapability, summary="文件能力说明")
async def get_file_capabilities(
    service: FileParserService = Depends(get_file_parser_service),
) -> FileCapability:
    return service.get_capability()

