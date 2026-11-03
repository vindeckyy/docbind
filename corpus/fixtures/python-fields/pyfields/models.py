class Request:
    def __init__(self, method: str, url: str) -> None:
        self.method = method
        self.url = url


class Response:
    @property
    def request(self) -> Request:
        return Request("GET", "/")


class BaseHandler:
    def handle(self, request: Request) -> None:
        pass


class Handler(BaseHandler):
    def handle(self, request):
        request.url


class Client:
    def get(self, url: str) -> Response:
        return Response()


def get_response() -> Response:
    return Response()


def describe(req):
    return req.url
