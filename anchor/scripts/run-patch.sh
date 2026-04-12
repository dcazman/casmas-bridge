#!/bin/bash
# Run the weather UI patch then clean up temp files
cd /srv/mergerfs/warehouse/casmas-bridge
node anchor/scripts/patch-weather-ui.js && echo "Patch applied"
