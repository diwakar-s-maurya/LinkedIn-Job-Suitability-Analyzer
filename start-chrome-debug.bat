@echo off
echo Starting Chrome with remote debugging...

REM Close any existing Chrome instances first
taskkill /F /IM chrome.exe 2>nul

REM Wait a moment for Chrome to fully close
timeout /t 2 /nobreak >nul

REM Start Chrome with remote debugging on port 9222
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="%USERPROFILE%\chrome-debug-profile"

echo Chrome started with remote debugging on port 9222
echo.
echo Once Chrome opens, log into https://www.linkedin.com/ if not already logged in.
echo Then run: npm run scrape
