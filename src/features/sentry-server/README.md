# sentry-server

Lazy server error reporting through `sentry` and `reportScrubbedError`. Routes import the index, which loads the SDK only when configured and needed. Failures degrade without breaking the request. Browser idle reporting belongs to `sentry-browser`; App Router connection scheduling belongs to `render-connection`.
