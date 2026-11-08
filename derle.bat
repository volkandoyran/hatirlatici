@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
echo === Hatirlaticilarim - derleme ===
echo.
echo [1/2] Web paketi olusturuluyor (vite build)...
call npm run build
if errorlevel 1 (
    echo.
    echo DERLEME BASARISIZ. "npm install" calistirip tekrar dene.
    pause
    exit /b 1
)
echo.
echo [2/2] iOS projesine aktariliyor (cap sync ios)...
echo Not: Windows'ta CocoaPods calismaz; pod install adimini Mac'te yapman gerekir.
call npx cap sync ios
echo.
echo TAMAMLANDI.
pause
