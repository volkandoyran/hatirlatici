#!/bin/sh
# Linux üzerinde Windows için derleme (gcc-mingw-w64-x86-64 paketi gerekir)
set -e
cd "$(dirname "$0")"
x86_64-w64-mingw32-gcc -O2 -Wall -municode -static -s -o ../teshis.exe teshis.c -lsetupapi
echo "Oluşturuldu: $(cd .. && pwd)/teshis.exe"
