"""统一定义后端业务错误及其 HTTP 映射。"""


class AppError(Exception):
    """后端业务层统一错误。"""

    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
