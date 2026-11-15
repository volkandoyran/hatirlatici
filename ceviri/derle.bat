@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
echo === Cevirilerim - derleme ===
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
if not exist "ios" (
    echo iOS projesi yok. Ilk kez icin Mac uzerinde "npm run ios:add" calistir.
    pause
    exit /b 0
)
echo [2/2] iOS projesine aktariliyor (cap sync ios)...
echo Not: Windows'ta CocoaPods calismaz; pod install adimini Mac'te yapman gerekir.
call npx cap sync ios
echo.
echo TAMAMLANDI.
pause
