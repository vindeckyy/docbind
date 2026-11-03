class Client:
    def get(self, url: str) -> "Response":
        return Response()


class Response:
    @property
    def status_code(self) -> int:
        return 200
