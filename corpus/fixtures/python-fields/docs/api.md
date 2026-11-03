# API

```python
from pyfields import Handler, get_response

response = get_response()
response.request.method

def show(req):
    req.method

show(response.request)

class MyHandler(Handler):
    def handle(self, request):
        request.url
```
