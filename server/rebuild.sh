#!/bin/bash
# Rebuild the server, then restart the running service.
# `&&` on purpose: a failed build must NOT restart the service, or it would come
# back up on the previous (or a half-written) dist/.

npm run build && systemctl --user restart cowork-mcp.service
