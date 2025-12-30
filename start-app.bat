@echo off
setlocal

REM Root folder = folder where this .bat is located
set "ROOT=%~dp0"

echo Starting backend server on port 3001...
start "Secure Mail Gateway Server" cmd /k cd /d "%ROOT%server" ^&^& npm run dev

echo Starting frontend UI on port 3000...
start "Secure Mail Gateway UI" cmd /k cd /d "%ROOT%" ^&^& npx vite

echo Waiting for UI to boot...
timeout /t 8 /nobreak >nul

echo Opening http://localhost:3000 ...
start "" "http://localhost:3000"

endlocal
