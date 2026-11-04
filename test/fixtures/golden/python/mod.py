MAX_RETRIES = 3


class Response:
    def __init__(self, status: int) -> None:
        self.status = status


def get_response(url: str, timeout: int = 10) -> Response:
    return Response(200)
