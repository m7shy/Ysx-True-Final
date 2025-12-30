@echo off
rem Count all files and folders recursively and show tree

tree /f
echo.

for /f %%a in ('dir /a-d /s /b ^| find /c /v ""') do set files=%%a
for /f %%b in ('dir /ad /s /b ^| find /c /v ""') do set folders=%%b
set /a total=files+folders

echo Total Files: %files%
echo Total Folders: %folders%
echo Total Items: %total%

echo.
pause
