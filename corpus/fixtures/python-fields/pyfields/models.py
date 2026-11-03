class Request:
    def __init__(self, method: str) -> None:
        self.method = method


class Response:
    @property
    def request(self) -> Request:
        return Request("GET")


def get_response() -> Response:
    return Response()
