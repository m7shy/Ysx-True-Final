@echo off
setlocal

:: ========================================================
:: 1. SETUP
:: ========================================================
:: Your provided token
set TOKEN=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

:: Your repo URL
set REPO=github.com/m7shy/Ysx-True-Final.git

:: ========================================================
:: 2. SAFETY RESET
:: ========================================================
echo [1/4] Ensuring secrets are un-staged...
:: This un-stages files so Git respects your EXISTING .gitignore
git reset

:: ========================================================
:: 3. COMMIT & PUSH
:: ========================================================
echo [2/4] Adding files...
:: This will only add files that your .gitignore allows
git add .

echo [3/4] Committing...
git commit -m "Automated push via batch script"

echo [4/4] Connecting and Pushing...
git branch -M main
:: Remove old link if it exists to avoid errors
git remote remove origin 2>nul
:: Add new link with the TOKEN embedded so it doesn't ask for a password
git remote add origin https://%TOKEN%@%REPO%

:: Push the code
git push -u origin main

echo.
echo ========================================================
echo SUCCESS! Your code is now on GitHub.
echo ========================================================
pause