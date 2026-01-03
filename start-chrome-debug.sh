#!/bin/bash

echo "Starting Chrome with remote debugging..."

# Close any existing Chrome instances first
pkill -f "chrome.*--remote-debugging-port=9222" 2>/dev/null

# Wait a moment for Chrome to fully close
sleep 2

# Detect Chrome path based on common locations
if [ -f "/usr/bin/google-chrome" ]; then
    CHROME_PATH="/usr/bin/google-chrome"
elif [ -f "/usr/bin/chromium-browser" ]; then
    CHROME_PATH="/usr/bin/chromium-browser"
elif [ -f "/usr/bin/chromium" ]; then
    CHROME_PATH="/usr/bin/chromium"
elif [ -f "/snap/bin/chromium" ]; then
    CHROME_PATH="/snap/bin/chromium"
elif [ -d "/Applications/Google Chrome.app" ]; then
    # macOS
    CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
else
    echo "Error: Could not find Chrome/Chromium installation"
    echo "Please install Google Chrome or Chromium"
    exit 1
fi

# Start Chrome with remote debugging on port 9222
"$CHROME_PATH" --remote-debugging-port=9222 --user-data-dir="$HOME/chrome-debug-profile" &

echo "Chrome started with remote debugging on port 9222"
echo ""
echo "Once Chrome opens, log into https://www.linkedin.com/ if not already logged in."
echo "Then run: npm run scrape"
