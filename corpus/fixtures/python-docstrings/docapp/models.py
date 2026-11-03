class Client:
    """Call `Client.get()` to fetch a response."""

    def get(self, url: str) -> "Response":
        return Response()


class Response:
    """Read `Response.status_code` after a call."""

    @property
    def status_code(self) -> int:
        return 200
