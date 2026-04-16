#!/usr/bin/env bash
# Keep the container alive indefinitely. Connect interactively via:
#   az containerapp exec -n <devbox-app-name> -g <resource-group> --command bash
# Or start a VS Code Remote Tunnel from inside:
#   gh auth login    # authenticate GitHub first
#   az login         # authenticate Azure
#   code tunnel      # follow the device-code URL, then attach from VS Code
set -e

echo "=============================================="
echo " Devbox is up. Ephemeral FS - tools baked in."
echo " Connect:  az containerapp exec -n <app> -g <rg> --command bash"
echo " Tunnel:   code tunnel  (after 'gh auth login' / 'az login')"
echo "=============================================="

# Block forever so the ACA replica stays alive.
exec tail -f /dev/null
