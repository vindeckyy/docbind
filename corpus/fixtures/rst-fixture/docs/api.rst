API
===

Call ``Client.get()`` and read :attr:`Response.status_code`.

.. code-block:: python

   client = Client()
   response = client.get("/")
   print(response.status_code)
