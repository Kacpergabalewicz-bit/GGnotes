@echo off
set /p REMOTE_URL=Podaj URL remote (https://github.com/USER/REPO.git):
git init
git add .
git commit -m "Initial GG Notes PWA"
git branch -M main
git remote add origin %REMOTE_URL%
git push -u origin main
echo Done.
pause
