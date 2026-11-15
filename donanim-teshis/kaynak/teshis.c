/*
 * Donanım Teşhis Aracı
 * --------------------
 * Windows açılmayan, ancak BIOS'a ve Windows kurulum (WinPE) ortamına
 * girebilen bilgisayarlarda arızalı parçayı bulmak için yazılmıştır.
 *
 * Windows kurulum USB'sinden açılıp Shift+F10 ile gelen komut isteminde
 * çalışır. PowerShell, .NET veya ek sürücü gerektirmez.
 *
 * Testler:
 *   - Sistem bilgisi (SMBIOS: anakart, BIOS, RAM yuvaları)
 *   - Disk SMART sağlık bilgisi (SATA/ATA ve NVMe)
 *   - Disk yüzey okuma testi (yalnızca OKUR, hiçbir şey yazmaz)
 *   - RAM testi (boş belleğin tamamı, 5 desen)
 *   - İşlemci (CPU) stres + hesap doğrulama + ısınma/yavaşlama ölçümü
 *   - Windows kurulumunun kontrolü: mavi ekran dökümleri, olay günlükleri,
 *     başlangıç onarma kaydı, önyükleme (BCD/EFI) yapılandırması
 *
 * Derleme (Linux): x86_64-w64-mingw32-gcc -O2 -municode -static \
 *     -o teshis.exe teshis.c -lsetupapi
 */
#define __USE_MINGW_ANSI_STDIO 1
#ifndef UNICODE
#define UNICODE
#endif
#ifndef _UNICODE
#define _UNICODE
#endif
#define _WIN32_WINNT 0x0602
#include <windows.h>
#include <winioctl.h>
#include <setupapi.h>
#include <cfgmgr32.h>
#include <conio.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <wchar.h>
#include <math.h>
#include <stdarg.h>

#define SURUM L"1.0"

/* ------------------------------------------------------------------ */
/* Çıktı: ekran + rapor dosyası                                        */
/* ------------------------------------------------------------------ */
static HANDLE g_out;
static BOOL g_console;
static HANDLE g_rep = INVALID_HANDLE_VALUE;
static wchar_t g_dir[MAX_PATH];
static wchar_t g_repPath[MAX_PATH];
static wchar_t g_toolDrive = 0; /* aracın çalıştığı sürücü harfi */
static int g_toolDisk = -1;     /* aracın bulunduğu fiziksel disk */

enum { C_NORMAL = 7, C_OK = 10, C_WARN = 14, C_ERR = 12, C_HEAD = 11, C_DIM = 8 };

static void write_utf8(HANDLE h, const wchar_t *s)
{
    int n = WideCharToMultiByte(CP_UTF8, 0, s, -1, NULL, 0, NULL, NULL);
    if (n <= 1) return;
    char *b = (char *)malloc(n);
    if (!b) return;
    WideCharToMultiByte(CP_UTF8, 0, s, -1, b, n, NULL, NULL);
    DWORD w;
    WriteFile(h, b, (DWORD)(n - 1), &w, NULL);
    free(b);
}

static void con_raw(const wchar_t *s)
{
    if (g_console) {
        DWORD w;
        WriteConsoleW(g_out, s, (DWORD)wcslen(s), &w, NULL);
    } else {
        write_utf8(g_out, s);
    }
}

static void set_color(int c)
{
    if (g_console) SetConsoleTextAttribute(g_out, (WORD)c);
}

static void rep_raw(const wchar_t *s)
{
    if (g_rep == INVALID_HANDLE_VALUE) return;
    size_t n = wcslen(s);
    wchar_t *t = (wchar_t *)malloc((n * 2 + 1) * sizeof(wchar_t));
    if (!t) return;
    size_t j = 0;
    for (size_t i = 0; i < n; i++) {
        if (s[i] == L'\r') continue;
        if (s[i] == L'\n') t[j++] = L'\r';
        t[j++] = s[i];
    }
    t[j] = 0;
    write_utf8(g_rep, t);
    free(t);
}

static void vpr(int color, int toRep, const wchar_t *fmt, va_list ap)
{
    wchar_t buf[8192];
    vswprintf(buf, 8192, fmt, ap);
    buf[8191] = 0;
    set_color(color);
    con_raw(buf);
    set_color(C_NORMAL);
    if (toRep) rep_raw(buf);
}

/* Ekran ve rapora yaz */
static void pr(const wchar_t *fmt, ...)
{
    va_list ap; va_start(ap, fmt); vpr(C_NORMAL, 1, fmt, ap); va_end(ap);
}
static void prc(int color, const wchar_t *fmt, ...)
{
    va_list ap; va_start(ap, fmt); vpr(color, 1, fmt, ap); va_end(ap);
}
/* Yalnızca ekrana (ilerleme satırları) */
static void con(const wchar_t *fmt, ...)
{
    va_list ap; va_start(ap, fmt); vpr(C_NORMAL, 0, fmt, ap); va_end(ap);
}
/* Yalnızca rapora */
static void rep(const wchar_t *fmt, ...)
{
    wchar_t buf[8192];
    va_list ap; va_start(ap, fmt); vswprintf(buf, 8192, fmt, ap); va_end(ap);
    buf[8191] = 0;
    rep_raw(buf);
}

static void flush_rep(void)
{
    if (g_rep != INVALID_HANDLE_VALUE) FlushFileBuffers(g_rep);
}

static void baslik(const wchar_t *t)
{
    prc(C_HEAD, L"\n==============================================================\n");
    prc(C_HEAD, L" %ls\n", t);
    prc(C_HEAD, L"==============================================================\n");
    flush_rep();
}

static void clear_line(void)
{
    if (g_console) con_raw(L"\r                                                                              \r");
}

/* ------------------------------------------------------------------ */
/* Bulgular                                                            */
/* ------------------------------------------------------------------ */
enum { S_BILGI = 0, S_UYARI = 1, S_HATA = 2 };

typedef struct {
    int sev;
    wchar_t parca[48];
    wchar_t mesaj[400];
    wchar_t oneri[400];
} Bulgu;

static Bulgu g_b[256];
static int g_nb = 0;

static void bulgu(int sev, const wchar_t *parca, const wchar_t *oneri, const wchar_t *fmt, ...)
{
    if (g_nb >= 256) return;
    Bulgu *b = &g_b[g_nb++];
    b->sev = sev;
    wcsncpy(b->parca, parca, 47); b->parca[47] = 0;
    wcsncpy(b->oneri, oneri ? oneri : L"", 399); b->oneri[399] = 0;
    va_list ap; va_start(ap, fmt); vswprintf(b->mesaj, 400, fmt, ap); va_end(ap);
    b->mesaj[399] = 0;
    if (sev == S_HATA) prc(C_ERR, L"  [HATA ] %ls\n", b->mesaj);
    else if (sev == S_UYARI) prc(C_WARN, L"  [UYARI] %ls\n", b->mesaj);
    else prc(C_DIM, L"  [BİLGİ] %ls\n", b->mesaj);
    flush_rep();
}

/* ------------------------------------------------------------------ */
/* Yardımcılar                                                         */
/* ------------------------------------------------------------------ */
static void trim(wchar_t *s)
{
    size_t n = wcslen(s);
    while (n && (s[n - 1] == L' ' || s[n - 1] == L'\t' || s[n - 1] == L'\r' || s[n - 1] == L'\n')) s[--n] = 0;
    size_t i = 0;
    while (s[i] == L' ' || s[i] == L'\t') i++;
    if (i) memmove(s, s + i, (wcslen(s + i) + 1) * sizeof(wchar_t));
}

static void a2w(const char *a, wchar_t *w, int wn)
{
    if (!a) { w[0] = 0; return; }
    MultiByteToWideChar(CP_ACP, 0, a, -1, w, wn);
    w[wn - 1] = 0;
    trim(w);
}

static double now_ms(void)
{
    static LARGE_INTEGER f = {0};
    LARGE_INTEGER c;
    if (!f.QuadPart) QueryPerformanceFrequency(&f);
    QueryPerformanceCounter(&c);
    return (double)c.QuadPart * 1000.0 / (double)f.QuadPart;
}

static void boyut_yaz(uint64_t b, wchar_t *out, int n)
{
    double v = (double)b;
    if (v >= 1e12) swprintf(out, n, L"%.2f TB", v / 1e12);
    else if (v >= 1e9) swprintf(out, n, L"%.1f GB", v / 1e9);
    else if (v >= 1e6) swprintf(out, n, L"%.0f MB", v / 1e6);
    else swprintf(out, n, L"%llu B", (unsigned long long)b);
}

static int esc_basildi(void)
{
    while (_kbhit()) {
        int c = _getch();
        if (c == 27) return 1;
    }
    return 0;
}

static BOOL dosya_var(const wchar_t *p)
{
    DWORD a = GetFileAttributesW(p);
    return a != INVALID_FILE_ATTRIBUTES && !(a & FILE_ATTRIBUTE_DIRECTORY);
}

static int64_t dosya_boyu(const wchar_t *p)
{
    WIN32_FILE_ATTRIBUTE_DATA d;
    if (!GetFileAttributesExW(p, GetFileExInfoStandard, &d)) return -1;
    return ((int64_t)d.nFileSizeHigh << 32) | d.nFileSizeLow;
}

static void zaman_yaz(const FILETIME *ft, wchar_t *out, int n)
{
    FILETIME lt; SYSTEMTIME st;
    FileTimeToLocalFileTime(ft, &lt);
    FileTimeToSystemTime(&lt, &st);
    swprintf(out, n, L"%02d.%02d.%04d %02d:%02d", st.wDay, st.wMonth, st.wYear, st.wHour, st.wMinute);
}

/* Bayt dizisini (UTF-16 ya da OEM/ANSI) geniş metne çevirir */
static wchar_t *metne_cevir(const char *buf, size_t len, UINT cp)
{
    wchar_t *w;
    if (len >= 2 && (unsigned char)buf[0] == 0xFF && (unsigned char)buf[1] == 0xFE) {
        size_t n = (len - 2) / 2;
        w = (wchar_t *)malloc((n + 1) * sizeof(wchar_t));
        memcpy(w, buf + 2, n * 2); w[n] = 0;
        return w;
    }
    size_t zeros = 0;
    for (size_t i = 1; i < len && i < 400; i += 2) if (buf[i] == 0) zeros++;
    if (len >= 4 && zeros > (len < 400 ? len : 400) / 4) {
        size_t n = len / 2;
        w = (wchar_t *)malloc((n + 1) * sizeof(wchar_t));
        memcpy(w, buf, n * 2); w[n] = 0;
        return w;
    }
    if (len >= 3 && (unsigned char)buf[0] == 0xEF && (unsigned char)buf[1] == 0xBB && (unsigned char)buf[2] == 0xBF) {
        buf += 3; len -= 3; cp = CP_UTF8;
    }
    int n = MultiByteToWideChar(cp, 0, buf, (int)len, NULL, 0);
    w = (wchar_t *)malloc((n + 1) * sizeof(wchar_t));
    MultiByteToWideChar(cp, 0, buf, (int)len, w, n);
    w[n] = 0;
    return w;
}

/* Bir komutu çalıştırıp çıktısını yakalar. Başarısızsa NULL. */
static wchar_t *komut_calistir(const wchar_t *cmd, DWORD zamanAsimiMs)
{
    SECURITY_ATTRIBUTES sa = { sizeof(sa), NULL, TRUE };
    HANDLE rd, wr;
    if (!CreatePipe(&rd, &wr, &sa, 0)) return NULL;
    SetHandleInformation(rd, HANDLE_FLAG_INHERIT, 0);
    STARTUPINFOW si; PROCESS_INFORMATION pi;
    ZeroMemory(&si, sizeof(si)); si.cb = sizeof(si);
    si.dwFlags = STARTF_USESTDHANDLES;
    si.hStdOutput = wr; si.hStdError = wr; si.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
    wchar_t *c = _wcsdup(cmd);
    BOOL ok = CreateProcessW(NULL, c, NULL, NULL, TRUE, CREATE_NO_WINDOW, NULL, NULL, &si, &pi);
    free(c);
    CloseHandle(wr);
    if (!ok) { CloseHandle(rd); return NULL; }
    size_t cap = 65536, len = 0;
    char *buf = (char *)malloc(cap);
    double t0 = now_ms();
    for (;;) {
        DWORD avail = 0;
        if (!PeekNamedPipe(rd, NULL, 0, NULL, &avail, NULL)) break; /* boru kapandı */
        if (avail) {
            if (len + avail + 1 > cap) { while (len + avail + 1 > cap) cap *= 2; buf = (char *)realloc(buf, cap); }
            DWORD r = 0;
            if (!ReadFile(rd, buf + len, avail, &r, NULL)) break;
            len += r;
            continue;
        }
        if (WaitForSingleObject(pi.hProcess, 30) == WAIT_OBJECT_0) {
            /* kalanları oku */
            for (;;) {
                if (!PeekNamedPipe(rd, NULL, 0, NULL, &avail, NULL) || !avail) break;
                if (len + avail + 1 > cap) { while (len + avail + 1 > cap) cap *= 2; buf = (char *)realloc(buf, cap); }
                DWORD r = 0;
                if (!ReadFile(rd, buf + len, avail, &r, NULL)) break;
                len += r;
            }
            break;
        }
        if (now_ms() - t0 > zamanAsimiMs) { TerminateProcess(pi.hProcess, 1); break; }
    }
    CloseHandle(rd);
    CloseHandle(pi.hProcess); CloseHandle(pi.hThread);
    wchar_t *w = metne_cevir(buf, len, CP_OEMCP);
    free(buf);
    return w;
}

static BOOL sistem_araci(const wchar_t *exe, wchar_t *out, int n)
{
    wchar_t sys[MAX_PATH];
    GetSystemDirectoryW(sys, MAX_PATH);
    swprintf(out, n, L"%ls\\%ls", sys, exe);
    return dosya_var(out);
}

/* ------------------------------------------------------------------ */
/* "Test sırasında kapandı mı?" takibi                                 */
/* ------------------------------------------------------------------ */
static void test_basladi(const wchar_t *parca, const wchar_t *ad)
{
    wchar_t p[MAX_PATH]; swprintf(p, MAX_PATH, L"%ls\\son_test.txt", g_dir);
    HANDLE h = CreateFileW(p, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, FILE_FLAG_WRITE_THROUGH, NULL);
    if (h != INVALID_HANDLE_VALUE) {
        wchar_t s[256]; swprintf(s, 256, L"%ls|%ls", parca, ad);
        write_utf8(h, s);
        FlushFileBuffers(h);
        CloseHandle(h);
    }
    rep(L"[BAŞLADI] %ls\n", ad);
    flush_rep();
}

static void test_bitti(const wchar_t *ad)
{
    wchar_t p[MAX_PATH]; swprintf(p, MAX_PATH, L"%ls\\son_test.txt", g_dir);
    DeleteFileW(p);
    rep(L"[BİTTİ] %ls\n", ad);
    flush_rep();
}

static void onceki_kapanma_kontrol(void)
{
    wchar_t p[MAX_PATH]; swprintf(p, MAX_PATH, L"%ls\\son_test.txt", g_dir);
    HANDLE h = CreateFileW(p, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, 0, NULL);
    if (h == INVALID_HANDLE_VALUE) return;
    char b[512] = {0}; DWORD r = 0;
    ReadFile(h, b, 511, &r, NULL);
    CloseHandle(h);
    DeleteFileW(p);
    wchar_t *w = metne_cevir(b, r, CP_UTF8);
    wchar_t *bar = wcschr(w, L'|');
    const wchar_t *parca = L"Bilinmiyor", *ad = w;
    if (bar) { *bar = 0; parca = w; ad = bar + 1; }
    baslik(L"ÖNCEKİ ÇALIŞTIRMA");
    const wchar_t *oneri;
    if (wcsstr(ad, L"CPU") || wcsstr(ad, L"İşlemci"))
        oneri = L"Yük altında kapanma: önce GÜÇ KAYNAĞI (PSU) ve İŞLEMCİ SOĞUTMASI (fan, termal macun, toz). Sonra anakart/işlemci.";
    else if (wcsstr(ad, L"RAM"))
        oneri = L"RAM testinde donma/kapanma: RAM modüllerini tek tek takarak deneyin; bozuk modülü/yuvayı bulun.";
    else if (wcsstr(ad, L"Disk"))
        oneri = L"Disk okurken donma: disk ya da SATA/güç kablosu arızalı olabilir. Diski başka kablo/porta takıp deneyin.";
    else
        oneri = L"Test sırasında sistem durdu; güç kaynağı, ısınma veya ilgili parça şüpheli.";
    bulgu(S_HATA, parca, oneri,
          L"Önceki çalıştırmada \"%ls\" sırasında bilgisayar KAPANDI / DONDU / YENİDEN BAŞLADI.", ad);
    free(w);
}

/* ------------------------------------------------------------------ */
/* Sistem bilgisi                                                      */
/* ------------------------------------------------------------------ */
static uint64_t g_smbiosRamMB = 0;
static int g_ramModulSayisi = 0;

static const char *smb_str(const BYTE *s, BYTE idx)
{
    if (!idx) return "";
    const char *p = (const char *)(s + s[1]);
    while (--idx) {
        if (!*p) return "";
        p += strlen(p) + 1;
    }
    return p;
}

static const wchar_t *ram_tipi(BYTE t)
{
    switch (t) {
    case 0x12: return L"DDR";
    case 0x13: return L"DDR2";
    case 0x18: return L"DDR3";
    case 0x1A: return L"DDR4";
    case 0x1B: return L"LPDDR";
    case 0x1C: return L"LPDDR2";
    case 0x1D: return L"LPDDR3";
    case 0x1E: return L"LPDDR4";
    case 0x22: return L"DDR5";
    case 0x23: return L"LPDDR5";
    default: return L"";
    }
}

static void smbios_oku(void)
{
    DWORD sz = GetSystemFirmwareTable(0x52534D42, 0, NULL, 0);
    if (!sz) { pr(L"  SMBIOS tablosu okunamadı.\n"); return; }
    BYTE *buf = (BYTE *)malloc(sz);
    GetSystemFirmwareTable(0x52534D42, 0, buf, sz);
    DWORD len = *(DWORD *)(buf + 4);
    BYTE *p = buf + 8, *end = buf + 8 + len;
    if (end > buf + sz) end = buf + sz;
    wchar_t a[128], b[128], c[128], d[128];
    int yuva = 0, bos = 0;
    g_smbiosRamMB = 0; g_ramModulSayisi = 0;

    /* İlk geçiş: sistem/anakart/BIOS */
    for (BYTE *s = p; s + 4 <= end;) {
        BYTE type = s[0], l = s[1];
        if (l < 4 || s + l > end) break;
        if (type == 1 && l >= 6) {
            a2w(smb_str(s, s[4]), a, 128); a2w(smb_str(s, s[5]), b, 128);
            if (a[0] || b[0]) pr(L"  Sistem      : %ls %ls\n", a, b);
        } else if (type == 2 && l >= 6) {
            a2w(smb_str(s, s[4]), a, 128); a2w(smb_str(s, s[5]), b, 128);
            if (a[0] || b[0]) pr(L"  Anakart     : %ls %ls\n", a, b);
        } else if (type == 0 && l >= 9) {
            a2w(smb_str(s, s[4]), a, 128); a2w(smb_str(s, s[5]), b, 128); a2w(smb_str(s, s[8]), c, 128);
            if (a[0] || b[0]) pr(L"  BIOS        : %ls, sürüm %ls (%ls)\n", a, b, c);
        } else if (type == 16 && l >= 0x0F) {
            yuva += *(WORD *)(s + 0x0D);
        }
        if (type == 127) break;
        BYTE *q = s + l;
        while (q + 1 < end && !(q[0] == 0 && q[1] == 0)) q++;
        s = q + 2;
    }

    pr(L"\n  RAM yuvaları (BIOS'un gördüğü):\n");
    for (BYTE *s = p; s + 4 <= end;) {
        BYTE type = s[0], l = s[1];
        if (l < 4 || s + l > end) break;
        if (type == 17 && l >= 0x15) {
            WORD szw = *(WORD *)(s + 0x0C);
            uint64_t mb = 0;
            a2w(smb_str(s, s[0x10]), a, 128);
            a2w(smb_str(s, s[0x11]), b, 128);
            if (szw == 0) {
                bos++;
                pr(L"    %-14ls %-12ls : BOŞ\n", a, b);
            } else {
                if (szw == 0xFFFF) mb = 0;
                else if (szw == 0x7FFF && l >= 0x20) mb = *(DWORD *)(s + 0x1C);
                else if (szw & 0x8000) mb = (szw & 0x7FFF) / 1024;
                else mb = szw;
                WORD hiz = l >= 0x17 ? *(WORD *)(s + 0x15) : 0;
                WORD cfg = l >= 0x22 ? *(WORD *)(s + 0x20) : 0;
                a2w(l > 0x17 ? smb_str(s, s[0x17]) : "", c, 128);
                a2w(l > 0x1A ? smb_str(s, s[0x1A]) : "", d, 128);
                pr(L"    %-14ls %-12ls : %llu MB %ls %u MT/s (çalışan %u) %ls %ls\n", a, b,
                   (unsigned long long)mb, ram_tipi(s[0x12]), hiz, cfg, c, d);
                g_smbiosRamMB += mb;
                g_ramModulSayisi++;
            }
        }
        if (type == 127) break;
        BYTE *q = s + l;
        while (q + 1 < end && !(q[0] == 0 && q[1] == 0)) q++;
        s = q + 2;
    }
    pr(L"  Toplam yuva: %d, dolu: %d, boş: %d, BIOS'ta görünen toplam RAM: %llu MB\n",
       yuva ? yuva : g_ramModulSayisi + bos, g_ramModulSayisi, bos, (unsigned long long)g_smbiosRamMB);
    prc(C_DIM, L"  ! Bilgisayarda FİZİKSEL olarak takılı modül sayısı bundan fazlaysa,\n"
               L"    görünmeyen modül ya da takılı olduğu yuva arızalıdır.\n");
    free(buf);
}

static void cihaz_listesi(void)
{
    HDEVINFO h = SetupDiGetClassDevsW(NULL, NULL, NULL, DIGCF_ALLCLASSES | DIGCF_PRESENT);
    if (h == INVALID_HANDLE_VALUE) return;
    SP_DEVINFO_DATA dd; dd.cbSize = sizeof(dd);
    const wchar_t *siniflar[] = { L"Display", L"SCSIAdapter", L"HDC", L"DiskDrive" };
    const wchar_t *adlar[] = { L"Ekran kartı", L"Depolama denet.", L"Depolama denet.", L"Disk" };
    pr(L"\n  Önemli aygıtlar:\n");
    for (DWORD i = 0; SetupDiEnumDeviceInfo(h, i, &dd); i++) {
        wchar_t cls[128] = {0}, ad[256] = {0};
        if (!SetupDiGetDeviceRegistryPropertyW(h, &dd, SPDRP_CLASS, NULL, (BYTE *)cls, sizeof(cls), NULL)) continue;
        int k = -1;
        for (int j = 0; j < 4; j++) if (!_wcsicmp(cls, siniflar[j])) k = j;
        if (k < 0) continue;
        if (!SetupDiGetDeviceRegistryPropertyW(h, &dd, SPDRP_FRIENDLYNAME, NULL, (BYTE *)ad, sizeof(ad), NULL))
            SetupDiGetDeviceRegistryPropertyW(h, &dd, SPDRP_DEVICEDESC, NULL, (BYTE *)ad, sizeof(ad), NULL);
        ULONG st = 0, prob = 0;
        CONFIGRET cr = CM_Get_DevNode_Status(&st, &prob, dd.DevInst, 0);
        if (cr == CR_SUCCESS && (st & DN_HAS_PROBLEM))
            pr(L"    %-16ls: %ls  (sorun kodu %lu)\n", adlar[k], ad, prob);
        else
            pr(L"    %-16ls: %ls\n", adlar[k], ad);
        if (k == 1 || k == 2) {
            wchar_t up[256]; wcsncpy(up, ad, 255); up[255] = 0; _wcsupr(up);
            if (wcsstr(up, L"RAID") || wcsstr(up, L"VMD") || wcsstr(up, L"RST"))
                bulgu(S_BILGI, L"BIOS ayarı", NULL, L"Depolama denetleyicisi RAID/VMD modunda: %ls", ad);
        }
    }
    SetupDiDestroyDeviceInfoList(h);
}

typedef enum { FT_UNKNOWN = 0, FT_BIOS = 1, FT_UEFI = 2 } FTYPE;
static int g_firmware = 0;

static void sistem_bilgisi(void)
{
    baslik(L"1) SİSTEM BİLGİSİ");
    typedef BOOL (WINAPI *GFT)(PDWORD);
    GFT gft = (GFT)(void *)GetProcAddress(GetModuleHandleW(L"kernel32.dll"), "GetFirmwareType");
    DWORD ft = 0;
    if (gft && gft(&ft)) g_firmware = (int)ft;
    pr(L"  Açılış modu : %ls\n", g_firmware == FT_UEFI ? L"UEFI" : g_firmware == FT_BIOS ? L"Eski BIOS (Legacy/CSM)" : L"Bilinmiyor");

    HKEY k;
    if (RegOpenKeyExW(HKEY_LOCAL_MACHINE, L"HARDWARE\\DESCRIPTION\\System\\CentralProcessor\\0", 0, KEY_READ, &k) == ERROR_SUCCESS) {
        wchar_t ad[256] = {0}; DWORD n = sizeof(ad);
        RegQueryValueExW(k, L"ProcessorNameString", NULL, NULL, (BYTE *)ad, &n);
        DWORD mhz = 0; n = sizeof(mhz);
        RegQueryValueExW(k, L"~MHz", NULL, NULL, (BYTE *)&mhz, &n);
        trim(ad);
        pr(L"  İşlemci     : %ls (~%lu MHz), %lu mantıksal çekirdek\n", ad, mhz,
           GetActiveProcessorCount(ALL_PROCESSOR_GROUPS));
        RegCloseKey(k);
    }
    MEMORYSTATUSEX ms; ms.dwLength = sizeof(ms);
    GlobalMemoryStatusEx(&ms);
    pr(L"  RAM (Windows'un gördüğü): %.1f GB toplam, %.1f GB boş\n",
       ms.ullTotalPhys / 1073741824.0, ms.ullAvailPhys / 1073741824.0);

    smbios_oku();

    if (g_smbiosRamMB > 0) {
        double gorunen = ms.ullTotalPhys / 1048576.0;
        if (gorunen < g_smbiosRamMB * 0.80)
            bulgu(S_UYARI, L"RAM",
                  L"BIOS'ta paylaşımlı ekran belleği çok yüksek değilse, bir RAM modülü ya da yuvası sorunlu. Modülleri tek tek deneyin.",
                  L"Takılı RAM %llu MB ama Windows yalnızca %.0f MB kullanabiliyor.",
                  (unsigned long long)g_smbiosRamMB, gorunen);
    }
    cihaz_listesi();
}

/* ------------------------------------------------------------------ */
/* Diskler                                                             */
/* ------------------------------------------------------------------ */
typedef struct {
    int no;
    wchar_t model[128];
    wchar_t seri[64];
    int bus;
    uint64_t boyut;
    DWORD sektor;
    int ssd; /* 1 SSD, 0 HDD, -1 bilinmiyor */
    int usb;
    int arac; /* bu aracın bulunduğu disk */
    int smartKotu;
} Disk;

static Disk g_d[32];
static int g_nd = 0;

static const wchar_t *bus_adi(int b)
{
    switch (b) {
    case 1: return L"SCSI";
    case 3: return L"ATA";
    case 7: return L"USB";
    case 8: return L"RAID";
    case 10: return L"SAS";
    case 11: return L"SATA";
    case 12: return L"SD";
    case 13: return L"MMC";
    case 15: return L"Sanal";
    case 17: return L"NVMe";
    default: return L"?";
    }
}

static void arac_diski_bul(void)
{
    wchar_t mod[MAX_PATH];
    GetModuleFileNameW(NULL, mod, MAX_PATH);
    if (mod[1] != L':') return;
    g_toolDrive = towupper(mod[0]);
    wchar_t v[16]; swprintf(v, 16, L"\\\\.\\%lc:", g_toolDrive);
    HANDLE h = CreateFileW(v, 0, FILE_SHARE_READ | FILE_SHARE_WRITE, NULL, OPEN_EXISTING, 0, NULL);
    if (h == INVALID_HANDLE_VALUE) return;
    BYTE buf[1024]; DWORD r;
    if (DeviceIoControl(h, IOCTL_VOLUME_GET_VOLUME_DISK_EXTENTS, NULL, 0, buf, sizeof(buf), &r, NULL)) {
        VOLUME_DISK_EXTENTS *e = (VOLUME_DISK_EXTENTS *)buf;
        if (e->NumberOfDiskExtents) g_toolDisk = (int)e->Extents[0].DiskNumber;
    }
    CloseHandle(h);
}

static HANDLE disk_ac(int no, DWORD erisim, DWORD bayrak)
{
    wchar_t p[64]; swprintf(p, 64, L"\\\\.\\PhysicalDrive%d", no);
    return CreateFileW(p, erisim, FILE_SHARE_READ | FILE_SHARE_WRITE, NULL, OPEN_EXISTING, bayrak, NULL);
}

static void diskleri_bul(void)
{
    g_nd = 0;
    for (int i = 0; i < 32 && g_nd < 32; i++) {
        HANDLE h = disk_ac(i, 0, 0);
        if (h == INVALID_HANDLE_VALUE) continue;
        Disk *d = &g_d[g_nd];
        ZeroMemory(d, sizeof(*d));
        d->no = i; d->ssd = -1;
        STORAGE_PROPERTY_QUERY q; ZeroMemory(&q, sizeof(q));
        q.PropertyId = StorageDeviceProperty; q.QueryType = PropertyStandardQuery;
        BYTE buf[4096]; DWORD r;
        if (DeviceIoControl(h, IOCTL_STORAGE_QUERY_PROPERTY, &q, sizeof(q), buf, sizeof(buf), &r, NULL)) {
            STORAGE_DEVICE_DESCRIPTOR *sd = (STORAGE_DEVICE_DESCRIPTOR *)buf;
            wchar_t v[64] = L"", m[128] = L"";
            if (sd->VendorIdOffset && sd->VendorIdOffset < r) a2w((char *)buf + sd->VendorIdOffset, v, 64);
            if (sd->ProductIdOffset && sd->ProductIdOffset < r) a2w((char *)buf + sd->ProductIdOffset, m, 128);
            if (sd->SerialNumberOffset && sd->SerialNumberOffset < r && sd->SerialNumberOffset != 0xFFFFFFFF)
                a2w((char *)buf + sd->SerialNumberOffset, d->seri, 64);
            if (v[0]) swprintf(d->model, 128, L"%ls %ls", v, m); else wcscpy(d->model, m);
            d->bus = sd->BusType;
            d->usb = sd->BusType == 7 || sd->RemovableMedia;
        }
        q.PropertyId = (STORAGE_PROPERTY_ID)7; /* StorageDeviceSeekPenaltyProperty */
        BYTE sp[64];
        if (DeviceIoControl(h, IOCTL_STORAGE_QUERY_PROPERTY, &q, sizeof(q), sp, sizeof(sp), &r, NULL) && r >= 9)
            d->ssd = sp[8] ? 0 : 1;
        if (d->bus == 17) d->ssd = 1;
        DISK_GEOMETRY_EX *g = (DISK_GEOMETRY_EX *)buf;
        if (DeviceIoControl(h, IOCTL_DISK_GET_DRIVE_GEOMETRY_EX, NULL, 0, buf, sizeof(buf), &r, NULL)) {
            d->boyut = (uint64_t)g->DiskSize.QuadPart;
            d->sektor = g->Geometry.BytesPerSector;
        }
        if (!d->sektor) d->sektor = 512;
        d->arac = (i == g_toolDisk);
        CloseHandle(h);
        g_nd++;
    }
}

static int dahili(const Disk *d) { return !d->usb && !d->arac; }

static void diskleri_listele(void)
{
    int dahiliSay = 0;
    for (int i = 0; i < g_nd; i++) {
        Disk *d = &g_d[i];
        wchar_t bs[32]; boyut_yaz(d->boyut, bs, 32);
        pr(L"  Disk %d: %ls  [%ls, %ls, %ls]%ls\n", d->no, d->model, bus_adi(d->bus), bs,
           d->ssd == 1 ? L"SSD" : d->ssd == 0 ? L"HDD" : L"tür ?",
           d->arac ? L"  <- bu aracın USB'si" : d->usb ? L"  (çıkarılabilir)" : L"");
        if (d->seri[0]) pr(L"          Seri no: %ls\n", d->seri);
        if (dahili(d)) dahiliSay++;
        if (dahili(d) && d->boyut == 0)
            bulgu(S_HATA, L"Disk", L"Disk kapasitesini bildiremiyor: disk arızalı ya da kablo/bağlantı sorunlu.",
                  L"Disk %d (%ls) kapasite bilgisi 0 – disk yanıt vermiyor.", d->no, d->model);
    }
    if (dahiliSay == 0)
        bulgu(S_HATA, L"Disk",
              L"BIOS'ta diskin görünüp görünmediğine bakın. Görünmüyorsa: SATA veri+güç kablosu / M.2 yuvası / disk arızası. "
              L"BIOS'ta görünüyorsa SATA modu (AHCI / RAID / Intel VMD) ayarını kontrol edin.",
              L"Hiç dahili disk bulunamadı!");
}

/* --- NVMe SMART --- */
typedef struct {
    DWORD ProtocolType, DataType, ProtocolDataRequestValue, ProtocolDataRequestSubValue;
    DWORD ProtocolDataOffset, ProtocolDataLength, FixedProtocolReturnData;
    DWORD SubValue2, SubValue3, SubValue4;
} PSD;

static uint64_t u64le(const BYTE *p) { uint64_t v; memcpy(&v, p, 8); return v; }

static int nvme_saglik(HANDLE h, BYTE *log)
{
    DWORD sz = 8 + sizeof(PSD) + 512;
    BYTE *buf = (BYTE *)calloc(1, sz);
    DWORD *q = (DWORD *)buf;
    q[0] = 50; /* StorageDeviceProtocolSpecificProperty */
    q[1] = 0;
    PSD *p = (PSD *)(buf + 8);
    p->ProtocolType = 3;  /* ProtocolTypeNvme */
    p->DataType = 2;      /* NVMeDataTypeLogPage */
    p->ProtocolDataRequestValue = 2; /* SMART / Health log */
    p->ProtocolDataOffset = sizeof(PSD);
    p->ProtocolDataLength = 512;
    DWORD r = 0;
    int ok = 0;
    if (DeviceIoControl(h, IOCTL_STORAGE_QUERY_PROPERTY, buf, sz, buf, sz, &r, NULL)) {
        PSD *o = (PSD *)(buf + 8);
        if (o->ProtocolDataOffset >= sizeof(PSD) && o->ProtocolDataLength >= 512 &&
            8 + o->ProtocolDataOffset + 512 <= sz) {
            memcpy(log, buf + 8 + o->ProtocolDataOffset, 512);
            ok = 1;
        }
    }
    free(buf);
    return ok;
}

static void nvme_degerlendir(Disk *d, const BYTE *l)
{
    int kritik = l[0];
    int sicak = (int)(l[1] | (l[2] << 8)) - 273;
    int yedek = l[3], yedekEsik = l[4], kullanim = l[5];
    uint64_t okunan = u64le(l + 32), yazilan = u64le(l + 48);
    uint64_t guc = u64le(l + 112), saat = u64le(l + 128), kapanma = u64le(l + 144);
    uint64_t medya = u64le(l + 160), hataLog = u64le(l + 176);
    pr(L"    NVMe sağlık kaydı:\n");
    pr(L"      Kritik uyarı bayrakları : 0x%02X\n", kritik);
    pr(L"      Sıcaklık                : %d °C\n", sicak);
    pr(L"      Yedek alan              : %%%d (eşik %%%d)\n", yedek, yedekEsik);
    pr(L"      Ömür kullanımı          : %%%d\n", kullanim);
    pr(L"      Çalışma süresi          : %llu saat, %llu kez açılmış\n", (unsigned long long)saat, (unsigned long long)guc);
    pr(L"      Okunan / yazılan        : %.1f TB / %.1f TB\n", okunan * 512000.0 / 1e12, yazilan * 512000.0 / 1e12);
    pr(L"      Beklenmedik kapanma     : %llu\n", (unsigned long long)kapanma);
    pr(L"      Medya/veri bütünlük hata: %llu\n", (unsigned long long)medya);
    pr(L"      Hata kaydı girdisi      : %llu\n", (unsigned long long)hataLog);
    const wchar_t *deg = L"Verileri hemen yedekleyin ve diski değiştirin.";
    if (kritik & 0x04) { bulgu(S_HATA, L"Disk", deg, L"Disk %d NVMe: güvenilirlik düşmüş (kritik uyarı bit 2).", d->no); d->smartKotu = 1; }
    if (kritik & 0x08) { bulgu(S_HATA, L"Disk", deg, L"Disk %d NVMe: salt-okunur moda geçmiş!", d->no); d->smartKotu = 1; }
    if (kritik & 0x01) { bulgu(S_HATA, L"Disk", deg, L"Disk %d NVMe: yedek alan eşiğin altında.", d->no); d->smartKotu = 1; }
    if (kritik & 0x10) { bulgu(S_HATA, L"Disk", deg, L"Disk %d NVMe: geçici bellek yedeği arızalı.", d->no); d->smartKotu = 1; }
    if (kritik & 0x02) bulgu(S_UYARI, L"Soğutma", L"SSD'nin hava akışını / soğutucusunu kontrol edin.", L"Disk %d NVMe: sıcaklık eşiği aşılmış.", d->no);
    if (medya > 0) { bulgu(S_HATA, L"Disk", deg, L"Disk %d NVMe: %llu medya/veri bütünlüğü hatası kaydedilmiş.", d->no, (unsigned long long)medya); d->smartKotu = 1; }
    if (kullanim >= 100) bulgu(S_HATA, L"Disk", deg, L"Disk %d NVMe: tasarım ömrünü doldurmuş (%%%d).", d->no, kullanim);
    else if (kullanim >= 90) bulgu(S_UYARI, L"Disk", L"Yakında değiştirmeyi planlayın.", L"Disk %d NVMe: ömrünün %%%d'i kullanılmış.", d->no, kullanim);
    if (sicak >= 75 && sicak < 200) bulgu(S_UYARI, L"Soğutma", L"SSD çok sıcak; soğutucu/hava akışı kontrol edilmeli.", L"Disk %d sıcaklığı %d °C.", d->no, sicak);
    if (!(kritik & 0x1F) && medya == 0 && kullanim < 90)
        prc(C_OK, L"    => NVMe sağlık durumu: İYİ\n");
}

/* --- ATA/SATA SMART --- */
#pragma pack(push, 1)
typedef struct { BYTE f, cnt, num, lo, hi, dh, cmd, res; } MYIDEREGS;
typedef struct { DWORD cBufferSize; MYIDEREGS r; BYTE drive; BYTE res[3]; DWORD dres[4]; BYTE buf[1]; } MYSCIP;
typedef struct { DWORD cBufferSize; BYTE drvErr, ideErr, res[2]; DWORD dres[2]; BYTE buf[512]; } MYSCOP;
#pragma pack(pop)

typedef struct {
    USHORT Length; USHORT AtaFlags;
    UCHAR PathId, TargetId, Lun, Res;
    ULONG DataTransferLength; ULONG TimeOutValue; ULONG Res2;
    ULONG_PTR DataBufferOffset;
    UCHAR Prev[8]; UCHAR Cur[8];
} MYAPT;
typedef struct { MYAPT a; ULONG fill[4]; BYTE data[512]; } MYAPTBUF;

#define MY_SMART_RCV 0x0007C088
#define MY_ATA_PT    0x0004D02C

static int ata_smart(HANDLE h, int no, BYTE feature, BYTE *out)
{
    MYSCIP in; MYSCOP o; DWORD r;
    ZeroMemory(&in, sizeof(in)); ZeroMemory(&o, sizeof(o));
    in.cBufferSize = 512;
    in.r.f = feature; in.r.cnt = 1; in.r.num = 1; in.r.lo = 0x4F; in.r.hi = 0xC2;
    in.r.dh = (BYTE)(0xA0 | ((no & 1) << 4)); in.r.cmd = 0xB0;
    in.drive = (BYTE)no;
    if (DeviceIoControl(h, MY_SMART_RCV, &in, sizeof(in) - 1, &o, sizeof(o), &r, NULL) && r >= 16 + 362) {
        memcpy(out, o.buf, 512);
        return 1;
    }
    MYAPTBUF pb; ZeroMemory(&pb, sizeof(pb));
    pb.a.Length = sizeof(MYAPT);
    pb.a.AtaFlags = 0x01 | 0x02; /* DRDY_REQUIRED | DATA_IN */
    pb.a.DataTransferLength = 512;
    pb.a.TimeOutValue = 10;
    pb.a.DataBufferOffset = offsetof(MYAPTBUF, data);
    pb.a.Cur[0] = feature; pb.a.Cur[1] = 1; pb.a.Cur[2] = 1; pb.a.Cur[3] = 0x4F; pb.a.Cur[4] = 0xC2;
    pb.a.Cur[5] = 0xA0; pb.a.Cur[6] = 0xB0;
    if (DeviceIoControl(h, MY_ATA_PT, &pb, sizeof(pb), &pb, sizeof(pb), &r, NULL) && !(pb.a.Cur[0] & 0x01)) {
        int bos = 1;
        for (int i = 0; i < 64; i++) if (pb.data[i]) { bos = 0; break; }
        if (!bos) { memcpy(out, pb.data, 512); return 1; }
    }
    return 0;
}

static const wchar_t *attr_adi(int id)
{
    switch (id) {
    case 1: return L"Okuma hata oranı";
    case 5: return L"Yeniden atanmış sektör";
    case 9: return L"Çalışma saati";
    case 10: return L"Dönme tekrar sayısı";
    case 12: return L"Açılma sayısı";
    case 169: return L"Kalan ömür";
    case 173: return L"Aşınma (silme sayısı)";
    case 177: return L"Aşınma dengeleme";
    case 184: return L"Uçtan uca hata";
    case 187: return L"Düzeltilemeyen hata";
    case 188: return L"Komut zaman aşımı";
    case 190: return L"Hava akış sıcaklığı";
    case 194: return L"Sıcaklık";
    case 196: return L"Yeniden atama olayı";
    case 197: return L"Bekleyen kararsız sektör";
    case 198: return L"Çevrimdışı düzelt. sektör";
    case 199: return L"UDMA CRC (kablo) hatası";
    case 231: return L"SSD kalan ömür";
    case 233: return L"Medya aşınma göstergesi";
    case 241: return L"Toplam yazılan";
    default: return L"";
    }
}

static void ata_degerlendir(Disk *d, const BYTE *val, const BYTE *thr, int thrOk)
{
    pr(L"    SMART öznitelikleri (ID  Ad                        Değer En kötü Eşik  Ham):\n");
    int sorun = 0;
    for (int i = 0; i < 30; i++) {
        const BYTE *a = val + 2 + i * 12;
        int id = a[0];
        if (!id) continue;
        int cur = a[3], worst = a[4];
        uint64_t raw = 0;
        for (int k = 5; k >= 0; k--) raw = (raw << 8) | a[5 + k];
        uint32_t raw32 = (uint32_t)(raw & 0xFFFFFFFF);
        int esik = 0;
        if (thrOk) for (int j = 0; j < 30; j++) if (thr[2 + j * 12] == id) { esik = thr[2 + j * 12 + 1]; break; }
        const wchar_t *ad = attr_adi(id);
        int onemli = ad[0] != 0;
        if (onemli || (esik && cur <= esik))
            pr(L"      %3d  %-26ls %3d   %3d    %3d  %llu\n", id, ad[0] ? ad : L"(diğer)", cur, worst, esik,
               (unsigned long long)((id == 194 || id == 190) ? (raw & 0xFF) : raw));
        else
            rep(L"      %3d  %-26ls %3d   %3d    %3d  %llu\n", id, L"(diğer)", cur, worst, esik, (unsigned long long)raw);

        const wchar_t *deg = L"Verileri hemen yedekleyin ve diski değiştirin.";
        if (esik && cur <= esik && esik != 0xFE) {
            bulgu(S_HATA, L"Disk", deg, L"Disk %d: SMART %d (%ls) EŞİĞİN ALTINDA – disk arızalı sayılır.", d->no, id, ad[0] ? ad : L"öznitelik");
            sorun = 2;
        }
        switch (id) {
        case 5:
            if (raw32 >= 100) { bulgu(S_HATA, L"Disk", deg, L"Disk %d: %u yeniden atanmış (bozuk) sektör.", d->no, raw32); sorun = 2; }
            else if (raw32 > 0) { bulgu(S_UYARI, L"Disk", L"Disk yıpranıyor; yedek alın ve takip edin.", L"Disk %d: %u yeniden atanmış sektör.", d->no, raw32); if (!sorun) sorun = 1; }
            break;
        case 197:
            if (raw32 > 0) { bulgu(S_HATA, L"Disk", deg, L"Disk %d: %u okunamayan (bekleyen) sektör – Windows dosyaları okunamıyor olabilir.", d->no, raw32); sorun = 2; }
            break;
        case 198:
            if (raw32 > 0) { bulgu(S_HATA, L"Disk", deg, L"Disk %d: %u düzeltilemeyen sektör.", d->no, raw32); sorun = 2; }
            break;
        case 187:
            if (raw32 > 0) { bulgu(S_UYARI, L"Disk", L"Disk veri hatası üretmiş; yedek alın.", L"Disk %d: %u düzeltilemeyen okuma hatası raporlanmış.", d->no, raw32); if (!sorun) sorun = 1; }
            break;
        case 184:
            if (raw32 > 0) { bulgu(S_HATA, L"Disk", deg, L"Disk %d: %u uçtan uca veri hatası.", d->no, raw32); sorun = 2; }
            break;
        case 10:
            if (raw32 > 0) { bulgu(S_UYARI, L"Disk", L"Mekanik sorun ya da yetersiz güç; güç kablosunu/PSU'yu da kontrol edin.", L"Disk %d: motor dönme tekrarı %u.", d->no, raw32); if (!sorun) sorun = 1; }
            break;
        case 199:
            if (raw32 > 0) bulgu(S_UYARI, L"Kablo/Bağlantı", L"SATA veri kablosunu değiştirin ya da başka SATA portuna takın.", L"Disk %d: %u UDMA CRC (iletim) hatası – kablo/port sorunu.", d->no, raw32);
            break;
        case 194: case 190: {
            int t = (int)(raw & 0xFF);
            if (t >= 60 && t < 120) bulgu(S_UYARI, L"Soğutma", L"Disk çok sıcak; kasa havalandırmasını kontrol edin.", L"Disk %d sıcaklığı %d °C.", d->no, t);
            break;
        }
        case 231: case 233: case 169: case 177:
            if (d->ssd == 1 && cur > 0 && cur <= 100) {
                if (cur <= 10) { bulgu(S_HATA, L"Disk", deg, L"Disk %d SSD: kalan ömür %%%d.", d->no, cur); sorun = 2; }
                else if (cur <= 30) bulgu(S_UYARI, L"Disk", L"SSD ömrünün sonuna yaklaşıyor.", L"Disk %d SSD: kalan ömür göstergesi %%%d.", d->no, cur);
            }
            break;
        }
    }
    if (sorun == 2) d->smartKotu = 1;
    if (!sorun) prc(C_OK, L"    => SMART durumu: İYİ\n");
}

static void smart_kontrol(void)
{
    baslik(L"2) DİSK SAĞLIĞI (SMART)");
    diskleri_bul();
    diskleri_listele();
    for (int i = 0; i < g_nd; i++) {
        Disk *d = &g_d[i];
        if (d->arac) continue;
        pr(L"\n  Disk %d – %ls\n", d->no, d->model);
        HANDLE h = disk_ac(d->no, GENERIC_READ | GENERIC_WRITE, 0);
        if (h == INVALID_HANDLE_VALUE) h = disk_ac(d->no, GENERIC_READ, 0);
        if (h == INVALID_HANDLE_VALUE) { pr(L"    Disk açılamadı (hata %lu)\n", GetLastError()); continue; }
        int okundu = 0;
        BYTE l[512];
        if (d->bus == 17 && nvme_saglik(h, l)) { nvme_degerlendir(d, l); okundu = 1; }
        if (!okundu) {
            BYTE val[512], thr[512];
            if (ata_smart(h, d->no, 0xD0, val)) {
                int thrOk = ata_smart(h, d->no, 0xD1, thr);
                ata_degerlendir(d, val, thr, thrOk);
                okundu = 1;
            }
        }
        /* Genel arıza tahmini */
        BYTE pf[516]; DWORD r;
        if (DeviceIoControl(h, IOCTL_STORAGE_PREDICT_FAILURE, NULL, 0, pf, sizeof(pf), &r, NULL)) {
            DWORD tahmin = *(DWORD *)pf;
            if (tahmin) {
                bulgu(S_HATA, L"Disk", L"Disk kendi arızasını bildiriyor. Verileri yedekleyin, diski değiştirin.",
                      L"Disk %d: SMART \"ARIZA YAKIN\" bildiriyor!", d->no);
                d->smartKotu = 1;
            } else if (!okundu) {
                prc(C_OK, L"    SMART ayrıntısı okunamadı; diskin genel arıza tahmini: SORUN YOK\n");
                okundu = 1;
            }
        }
        if (!okundu) pr(L"    SMART bilgisi okunamadı (USB kutusu / RAID / sürücü desteklemiyor olabilir).\n");
        CloseHandle(h);
    }
}

/* --- Disk yüzey okuma testi --- */
typedef struct {
    HANDLE h; OVERLAPPED ov; BYTE *buf; DWORD sonHata;
} Okuyucu;

/* Gerçek ortam (yüzey) hatası mı, yoksa erişim/yazılım hatası mı? */
static int medya_hatasi(DWORD e)
{
    return e == ERROR_CRC || e == ERROR_SECTOR_NOT_FOUND || e == 1117 /*IO_DEVICE*/ ||
           e == 483 /*DEVICE_HARDWARE_ERROR*/ || e == ERROR_SEM_TIMEOUT || e == 433 /*NO_SUCH_DEVICE*/ ||
           e == 1167 /*DEVICE_NOT_CONNECTED*/ || e == ERROR_READ_FAULT || e == ERROR_GEN_FAILURE ||
           e == ERROR_NOT_READY || e == 1110 /*MEDIA_CHANGED*/ || e == ERROR_OPERATION_ABORTED;
}

/* 0 başarılı, 1 okuma hatası, 2 zaman aşımı */
static int oku(Okuyucu *o, uint64_t ofs, DWORD len, double *ms)
{
    o->ov.Offset = (DWORD)(ofs & 0xFFFFFFFF);
    o->ov.OffsetHigh = (DWORD)(ofs >> 32);
    o->ov.Internal = o->ov.InternalHigh = 0;
    ResetEvent(o->ov.hEvent);
    double t0 = now_ms();
    DWORD n = 0;
    o->sonHata = 0;
    if (!ReadFile(o->h, o->buf, len, NULL, &o->ov)) {
        if (GetLastError() != ERROR_IO_PENDING) { o->sonHata = GetLastError(); *ms = now_ms() - t0; return 1; }
        DWORD w = WaitForSingleObject(o->ov.hEvent, 20000);
        if (w == WAIT_TIMEOUT) {
            CancelIoEx(o->h, &o->ov);
            GetOverlappedResult(o->h, &o->ov, &n, TRUE);
            *ms = now_ms() - t0;
            return 2;
        }
    }
    BOOL ok = GetOverlappedResult(o->h, &o->ov, &n, TRUE);
    if (!ok) o->sonHata = GetLastError();
    *ms = now_ms() - t0;
    if (ok && n == len) return 0;
    if (ok) o->sonHata = ERROR_READ_FAULT; /* eksik okuma */
    return 1;
}

static void disk_yuzey_testi(Disk *d, int tam)
{
    wchar_t ad[128]; swprintf(ad, 128, L"Disk %d yüzey okuma testi", d->no);
    wchar_t bs[32]; boyut_yaz(d->boyut, bs, 32);
    pr(L"\n  Disk %d – %ls (%ls) – %ls test\n", d->no, d->model, bs, tam ? L"TAM" : L"HIZLI");
    if (!d->boyut) { pr(L"    Kapasite bilinmiyor, atlandı.\n"); return; }
    Okuyucu o; ZeroMemory(&o, sizeof(o));
    o.h = disk_ac(d->no, GENERIC_READ, FILE_FLAG_NO_BUFFERING | FILE_FLAG_OVERLAPPED);
    if (o.h == INVALID_HANDLE_VALUE) { pr(L"    Disk açılamadı (hata %lu)\n", GetLastError()); return; }
    const DWORD blok = tam ? 4u << 20 : 1u << 20;
    o.buf = (BYTE *)VirtualAlloc(NULL, blok, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
    o.ov.hEvent = CreateEventW(NULL, TRUE, FALSE, NULL);
    test_basladi(L"Disk", ad);

    double yavasEsik = d->ssd == 1 ? 300.0 : 1000.0;
    double cokYavasEsik = d->ssd == 1 ? 2000.0 : 3000.0;
    uint64_t hata = 0, asim = 0, yavas = 0, cokYavas = 0, okunan = 0;
    uint64_t hataYer[20]; int nh = 0;
    double seqMs = 0; uint64_t seqBayt = 0;
    double maxMs = 0;
    uint64_t sektorMaske = ~(uint64_t)(d->sektor - 1);
    int iptal = 0, erisimHatasi = 0, ardisikErisim = 0;
    DWORD erisimKod = 0;

    /* Plan: tam testte tüm disk sıralı; hızlıda ilk 1 GB sıralı + 1500 örnek */
    uint64_t sirali = tam ? d->boyut : (d->boyut < (1ull << 30) ? d->boyut : (1ull << 30));
    uint64_t ornek = tam ? 0 : 1500;
    uint64_t toplamAdim = (sirali + blok - 1) / blok + ornek;
    uint64_t adim = 0;
    double t0 = now_ms(), sonEkran = 0;

    for (uint64_t i = 0; i < toplamAdim && !iptal; i++, adim++) {
        uint64_t ofs; DWORD len = blok;
        int seq = i < (sirali + blok - 1) / blok;
        if (seq) ofs = i * (uint64_t)blok;
        else {
            uint64_t k = i - (sirali + blok - 1) / blok;
            ofs = (d->boyut / ornek) * k;
            ofs &= ~((uint64_t)blok - 1);
        }
        if (ofs >= d->boyut) continue;
        if (ofs + len > d->boyut) len = (DWORD)((d->boyut - ofs) & sektorMaske);
        if (!len) continue;
        double ms;
        int s = oku(&o, ofs, len, &ms);
        if (ms > maxMs) maxMs = ms;
        if (s == 0) {
            okunan += len;
            if (seq) { seqMs += ms; seqBayt += len; }
            if (ms > cokYavasEsik) cokYavas++;
            else if (ms > yavasEsik) yavas++;
        } else if (s == 1 && !medya_hatasi(o.sonHata)) {
            /* yazılımsal/erişim hatası: diski suçlama */
            erisimHatasi++; ardisikErisim++; erisimKod = o.sonHata;
            if (ardisikErisim >= 5) {
                clear_line();
                pr(L"    Disk okunamıyor (Windows hata kodu %lu) – bu bir erişim sorunu, test yapılamadı.\n", erisimKod);
                break;
            }
        } else {
            ardisikErisim = 0;
            if (s == 2) asim++; else hata++;
            if (nh < 20) hataYer[nh++] = ofs;
            clear_line();
            if (hata + asim <= 25)
                prc(C_ERR, L"    ! %.2f GB konumunda %ls\n", ofs / 1e9,
                    s == 2 ? L"YANIT YOK (20 sn)" : L"OKUMA HATASI");
            else if (hata + asim == 26)
                prc(C_ERR, L"    ! (daha fazla hata var, listelenmiyor)\n");
            flush_rep();
            if (asim >= 5) { prc(C_ERR, L"    Disk yanıt vermiyor, test durduruldu.\n"); break; }
            if (hata >= 2000) { prc(C_ERR, L"    Çok fazla hata, test durduruldu.\n"); break; }
        }
        if (s == 0) ardisikErisim = 0;
        double t = now_ms();
        if (t - sonEkran > 400) {
            sonEkran = t;
            double gecen = (t - t0) / 1000.0;
            double oran = (double)(adim + 1) / toplamAdim;
            double kalan = oran > 0 ? gecen / oran - gecen : 0;
            con(L"\r    %%%5.1f  hız %6.1f MB/sn  hata %llu  yavaş %llu  kalan ~%d dk  (ESC=durdur)   ",
                oran * 100.0, seqMs > 0 ? seqBayt / 1e6 / (seqMs / 1000.0) : 0.0,
                (unsigned long long)(hata + asim), (unsigned long long)(yavas + cokYavas), (int)(kalan / 60) + 1);
            if (esc_basildi()) { iptal = 1; }
        }
    }
    clear_line();
    test_bitti(ad);
    if (iptal) pr(L"    (Kullanıcı tarafından durduruldu)\n");
    double hiz = seqMs > 0 ? seqBayt / 1e6 / (seqMs / 1000.0) : 0;
    wchar_t ob[32]; boyut_yaz(okunan, ob, 32);
    pr(L"    Okunan: %ls, sıralı okuma hızı: %.1f MB/sn, en yavaş blok: %.0f ms\n", ob, hiz, maxMs);
    pr(L"    Okuma hatası: %llu, yanıtsız: %llu, yavaş blok: %llu, çok yavaş blok: %llu\n",
       (unsigned long long)hata, (unsigned long long)asim, (unsigned long long)yavas, (unsigned long long)cokYavas);
    if (nh) {
        pr(L"    Hatalı bölgeler (GB): ");
        for (int k = 0; k < nh; k++) pr(L"%.2f ", hataYer[k] / 1e9);
        pr(L"\n");
    }
    const wchar_t *deg = L"Disk bozuk. Verileri (mümkünse) kurtarın ve diski değiştirin. Windows'un açılmamasının en olası nedeni budur.";
    if (erisimHatasi && !okunan && !hata && !asim) {
        bulgu(S_BILGI, L"Disk", NULL, L"Disk %d yüzey testi yapılamadı (erişim hatası %lu).", d->no, erisimKod);
    } else if (hata || asim)
        bulgu(S_HATA, L"Disk", deg, L"Disk %d (%ls): %llu okuma hatası, %llu yanıtsız bölge.", d->no, d->model,
              (unsigned long long)hata, (unsigned long long)asim);
    else if (cokYavas >= 3)
        bulgu(S_HATA, L"Disk", L"Disk zayıf sektörleri okumakta zorlanıyor; Windows bu yüzden açılmıyor/takılıyor olabilir. Değiştirin.",
              L"Disk %d: %llu blok %.0f ms'den uzun sürede okundu.", d->no, (unsigned long long)cokYavas, cokYavasEsik);
    else if (yavas + cokYavas >= 10)
        bulgu(S_UYARI, L"Disk", L"Diskte yavaş bölgeler var; yaşlanan disk belirtisi. Yedek alın.",
              L"Disk %d: %llu yavaş blok.", d->no, (unsigned long long)(yavas + cokYavas));
    else if (seqBayt > (256ull << 20) && ((d->ssd == 1 && hiz < 60) || (d->ssd == 0 && hiz < 25)))
        bulgu(S_UYARI, L"Disk", L"Disk beklenenden çok yavaş; disk, kablo veya BIOS SATA modu (IDE) kontrol edilmeli.",
              L"Disk %d sıralı okuma hızı yalnızca %.1f MB/sn.", d->no, hiz);
    else if (!iptal)
        prc(C_OK, L"    => Okuma testi: SORUN YOK\n");
    VirtualFree(o.buf, 0, MEM_RELEASE);
    CloseHandle(o.ov.hEvent);
    CloseHandle(o.h);
}

static void disk_testleri(int tam, int sorDiski)
{
    baslik(tam ? L"3) DİSK YÜZEY TESTİ (TAM – yalnızca okur)" : L"3) DİSK YÜZEY TESTİ (HIZLI – yalnızca okur)");
    if (!g_nd) diskleri_bul();
    if (sorDiski) {
        diskleri_listele();
        con(L"\n  Test edilecek disk numarası (Enter = tüm dahili diskler): ");
        wchar_t s[16] = {0};
        if (fgetws(s, 16, stdin)) {
            trim(s);
            if (s[0]) {
                int no = _wtoi(s);
                for (int i = 0; i < g_nd; i++) if (g_d[i].no == no) { disk_yuzey_testi(&g_d[i], tam); return; }
                pr(L"  Böyle bir disk yok.\n");
                return;
            }
        }
    }
    int say = 0;
    for (int i = 0; i < g_nd; i++) if (dahili(&g_d[i])) { disk_yuzey_testi(&g_d[i], tam); say++; }
    if (!say) pr(L"  Test edilecek dahili disk yok.\n");
}

/* ------------------------------------------------------------------ */
/* RAM testi                                                           */
/* ------------------------------------------------------------------ */
typedef struct { uint64_t *p; size_t n; } Parca;
static Parca g_parca[4096];
static int g_nparca = 0;
static volatile LONG64 g_ramIlerleme = 0;
static volatile LONG64 g_ramHata = 0;
static volatile uint64_t g_ramBitler = 0;
static CRITICAL_SECTION g_ramCs;
typedef struct { uintptr_t adr; uint64_t bek, gel; } RamHata;
static RamHata g_ramHk[32];
static int g_nRamHk = 0;
static volatile LONG g_ramDur = 0;

typedef struct { int id, toplam, gecis; } RamIs;

static inline uint64_t xs64(uint64_t *s)
{
    uint64_t x = *s;
    x ^= x << 13; x ^= x >> 7; x ^= x << 17;
    return *s = x;
}

static void ram_hata_kaydet(uint64_t *adr, uint64_t bek, uint64_t gel)
{
    InterlockedIncrement64(&g_ramHata);
    EnterCriticalSection(&g_ramCs);
    g_ramBitler |= (bek ^ gel);
    if (g_nRamHk < 32) { g_ramHk[g_nRamHk].adr = (uintptr_t)adr; g_ramHk[g_nRamHk].bek = bek; g_ramHk[g_nRamHk].gel = gel; g_nRamHk++; }
    LeaveCriticalSection(&g_ramCs);
}

static uint64_t desen_degeri(int desen, uint64_t *adr, size_t i, uint64_t *rs)
{
    switch (desen) {
    case 0: return (uint64_t)(uintptr_t)adr;
    case 1: return (i & 1) ? 0xAAAAAAAAAAAAAAAAull : 0x5555555555555555ull;
    case 2: return (i & 1) ? 0x5555555555555555ull : 0xAAAAAAAAAAAAAAAAull;
    case 3: return xs64(rs);
    default: return ~(uint64_t)(uintptr_t)adr;
    }
}

static DWORD WINAPI ram_isci(LPVOID arg)
{
    RamIs *is = (RamIs *)arg;
    for (int desen = 0; desen < 5 && !g_ramDur; desen++) {
        for (int c = is->id; c < g_nparca && !g_ramDur; c += is->toplam) {
            uint64_t *p = g_parca[c].p; size_t n = g_parca[c].n;
            uint64_t rs = 0x9E3779B97F4A7C15ull ^ ((uint64_t)c * 0x100000001B3ull) ^ ((uint64_t)is->gecis << 40);
            for (size_t i = 0; i < n; i++) p[i] = desen_degeri(desen, &p[i], i, &rs);
            InterlockedAdd64(&g_ramIlerleme, (LONG64)(n * 8));
        }
        for (int c = is->id; c < g_nparca && !g_ramDur; c += is->toplam) {
            uint64_t *p = g_parca[c].p; size_t n = g_parca[c].n;
            uint64_t rs = 0x9E3779B97F4A7C15ull ^ ((uint64_t)c * 0x100000001B3ull) ^ ((uint64_t)is->gecis << 40);
            for (size_t i = 0; i < n; i++) {
                uint64_t b = desen_degeri(desen, &p[i], i, &rs);
                uint64_t v = p[i];
                if (v != b) {
                    /* tekrar oku: kalıcı mı geçici mi */
                    ram_hata_kaydet(&p[i], b, v);
                }
            }
            InterlockedAdd64(&g_ramIlerleme, (LONG64)(n * 8));
        }
    }
    return 0;
}

static void ram_testi(int gecisSayisi)
{
    baslik(L"4) RAM TESTİ");
    MEMORYSTATUSEX ms; ms.dwLength = sizeof(ms);
    GlobalMemoryStatusEx(&ms);
    uint64_t hedef = (uint64_t)(ms.ullAvailPhys * 0.85);
    if (hedef > (64ull << 20)) hedef -= 64ull << 20;
    const size_t parcaBoy = 64u << 20;
    g_nparca = 0;
    uint64_t ayrilan = 0;
    size_t boy = parcaBoy;
    while (ayrilan + (1u << 20) <= hedef && g_nparca < 4096) {
        if (ayrilan + boy > hedef) boy = (size_t)((hedef - ayrilan) & ~((uint64_t)(1u << 20) - 1));
        if (boy < (1u << 20)) break;
        void *p = VirtualAlloc(NULL, boy, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
        if (!p) { if (boy > (4u << 20)) { boy /= 2; continue; } break; }
        g_parca[g_nparca].p = (uint64_t *)p; g_parca[g_nparca].n = boy / 8; g_nparca++;
        ayrilan += boy;
    }
    pr(L"  Toplam RAM %.1f GB, test edilen: %.1f GB (%d parça), %d geçiş × 5 desen\n",
       ms.ullTotalPhys / 1073741824.0, ayrilan / 1073741824.0, g_nparca, gecisSayisi);
    prc(C_DIM, L"  Not: Çalışan kurulum ortamının kullandığı küçük bir alan test edilemez.\n");
    if (!g_nparca) { pr(L"  Bellek ayrılamadı.\n"); return; }

    InitializeCriticalSection(&g_ramCs);
    g_ramHata = 0; g_ramBitler = 0; g_nRamHk = 0; g_ramDur = 0;
    int t = (int)GetActiveProcessorCount(ALL_PROCESSOR_GROUPS);
    if (t < 1) t = 1;
    if (t > 32) t = 32;
    test_basladi(L"RAM", L"RAM testi");
    double t0 = now_ms();
    uint64_t toplam = ayrilan * 5 * 2 * (uint64_t)gecisSayisi;
    g_ramIlerleme = 0;
    for (int g = 0; g < gecisSayisi && !g_ramDur; g++) {
        HANDLE th[32]; RamIs is[32];
        for (int i = 0; i < t; i++) {
            is[i].id = i; is[i].toplam = t; is[i].gecis = g;
            th[i] = CreateThread(NULL, 0, ram_isci, &is[i], 0, NULL);
        }
        for (;;) {
            DWORD w = WaitForMultipleObjects(t, th, TRUE, 500);
            double oran = (double)g_ramIlerleme / toplam;
            double gecen = (now_ms() - t0) / 1000.0;
            con(L"\r  Geçiş %d/%d  %%%5.1f  hata: %lld  geçen %d sn  (ESC=durdur)     ", g + 1, gecisSayisi,
                oran * 100, (long long)g_ramHata, (int)gecen);
            if (esc_basildi()) g_ramDur = 1;
            if (w != WAIT_TIMEOUT) break;
        }
        for (int i = 0; i < t; i++) CloseHandle(th[i]);
    }
    clear_line();
    test_bitti(L"RAM testi");
    double sure = (now_ms() - t0) / 1000.0;
    pr(L"  Süre: %.0f sn, bellek hızı ~%.1f GB/sn\n", sure, g_ramIlerleme / 1e9 / (sure > 0 ? sure : 1));
    if (g_ramDur) pr(L"  (Kullanıcı tarafından durduruldu)\n");
    if (g_ramHata) {
        pr(L"  Hatalı adresler (ilk %d):\n", g_nRamHk);
        for (int i = 0; i < g_nRamHk; i++)
            pr(L"    %p  beklenen %016llX  okunan %016llX\n", (void *)g_ramHk[i].adr,
               (unsigned long long)g_ramHk[i].bek, (unsigned long long)g_ramHk[i].gel);
        pr(L"  Hatalı bit maskesi: %016llX\n", (unsigned long long)g_ramBitler);
        bulgu(S_HATA, L"RAM",
              L"RAM arızalı. Modülleri TEK TEK takıp testi tekrarlayın; hatayı veren modülü değiştirin. "
              L"BIOS'ta XMP/EXPO açıksa önce kapatıp tekrar deneyin.",
              L"RAM testinde %lld hata bulundu!", (long long)g_ramHata);
    } else {
        prc(C_OK, L"  => RAM testi: HATA YOK\n");
    }
    for (int i = 0; i < g_nparca; i++) VirtualFree(g_parca[i].p, 0, MEM_RELEASE);
    g_nparca = 0;
    DeleteCriticalSection(&g_ramCs);
}

/* ------------------------------------------------------------------ */
/* CPU stres testi                                                     */
/* ------------------------------------------------------------------ */
#define CPU_TOHUM 64
static uint64_t g_cpuRef[CPU_TOHUM];
static volatile LONG g_cpuDur = 0;
static volatile LONG64 g_cpuIs = 0;
static volatile LONG64 g_cpuHata = 0;

static uint64_t cpu_is(uint64_t tohum, uint32_t *dizi)
{
    uint64_t x = tohum * 0x9E3779B97F4A7C15ull + 1;
    for (int i = 0; i < 65536; i++) { x ^= x << 13; x ^= x >> 7; x ^= x << 17; dizi[i] = (uint32_t)x; }
    double d = 1.0 + (double)(tohum & 255) / 1000.0, e = 0.5;
    for (int i = 0; i < 400000; i++) {
        x ^= x << 13; x ^= x >> 7; x ^= x << 17;
        uint32_t k = dizi[x & 65535];
        dizi[(x >> 20) & 65535] = k ^ (uint32_t)i;
        x += k * 0x2545F4914F6CDD1Dull;
        d = d * 1.0000001 + (double)(k & 0xFFFF) * 1e-9;
        e = e + sqrt(d) * 1e-7 - e * 1e-8;
        if (d > 2.0) d = sqrt(d);
    }
    uint64_t dd, ee;
    memcpy(&dd, &d, 8); memcpy(&ee, &e, 8);
    return x ^ dd ^ (ee << 1);
}

static DWORD WINAPI cpu_isci(LPVOID arg)
{
    (void)arg;
    uint32_t *dizi = (uint32_t *)malloc(65536 * 4);
    uint64_t i = (uint64_t)(uintptr_t)arg;
    while (!g_cpuDur) {
        uint64_t t = i % CPU_TOHUM;
        if (cpu_is(t, dizi) != g_cpuRef[t]) InterlockedIncrement64(&g_cpuHata);
        InterlockedIncrement64(&g_cpuIs);
        i++;
    }
    free(dizi);
    return 0;
}

static int sicaklik_oku(wchar_t *out, int n)
{
    wchar_t wmic[MAX_PATH];
    out[0] = 0;
    if (!sistem_araci(L"wbem\\wmic.exe", wmic, MAX_PATH)) return 0;
    wchar_t cmd[512];
    swprintf(cmd, 512, L"\"%ls\" /namespace:\\\\root\\wmi PATH MSAcpi_ThermalZoneTemperature get CurrentTemperature /value", wmic);
    wchar_t *o = komut_calistir(cmd, 15000);
    if (!o) return 0;
    int say = 0, enYuksek = -1000;
    wchar_t *p = o;
    while ((p = wcsstr(p, L"CurrentTemperature=")) != NULL) {
        p += 19;
        long v = wcstol(p, NULL, 10);
        int c = (int)(v / 10 - 273);
        if (c > -50 && c < 150) {
            int l = (int)wcslen(out);
            swprintf(out + l, n - l, L"%ls%d °C", say ? L", " : L"", c);
            if (c > enYuksek) enYuksek = c;
            say++;
        }
    }
    free(o);
    return say ? enYuksek : 0;
}

static void cpu_testi(int saniye)
{
    baslik(L"5) İŞLEMCİ (CPU) STRES TESTİ");
    int t = (int)GetActiveProcessorCount(ALL_PROCESSOR_GROUPS);
    if (t < 1) t = 1;
    if (t > 64) t = 64;
    pr(L"  %d iş parçacığı, %d saniye. Bilgisayar bu sırada KAPANIR veya DONARSA\n"
       L"  güç kaynağı / işlemci soğutması / anakart şüphelidir (bir sonraki\n"
       L"  açılışta bu araç bunu otomatik raporlar).\n", t, saniye);
    wchar_t s1[256], s2[256];
    int ilkSic = sicaklik_oku(s1, 256);
    if (s1[0]) pr(L"  Test öncesi ACPI sıcaklık: %ls\n", s1);

    uint32_t *dizi = (uint32_t *)malloc(65536 * 4);
    con(L"  Referans değerler hesaplanıyor...");
    for (int i = 0; i < CPU_TOHUM; i++) g_cpuRef[i] = cpu_is((uint64_t)i, dizi);
    /* tutarlılık: aynı hesap iki kez aynı sonucu vermeli */
    int tutarsiz = 0;
    for (int i = 0; i < 8; i++) if (cpu_is((uint64_t)i, dizi) != g_cpuRef[i]) tutarsiz++;
    free(dizi);
    clear_line();

    g_cpuDur = 0; g_cpuIs = 0; g_cpuHata = tutarsiz;
    test_basladi(L"İşlemci/Güç/Soğutma", L"CPU stres testi");
    HANDLE th[64];
    for (int i = 0; i < t; i++) th[i] = CreateThread(NULL, 0, cpu_isci, (LPVOID)(uintptr_t)(i * 7), 0, NULL);
    double hizlar[3600]; int nh = 0;
    double t0 = now_ms();
    LONG64 onceki = 0; double oncekiT = t0;
    int iptal = 0;
    while (!iptal) {
        Sleep(1000);
        double sn = now_ms();
        LONG64 is = g_cpuIs;
        double hiz = (is - onceki) / ((sn - oncekiT) / 1000.0);
        onceki = is; oncekiT = sn;
        if (nh < 3600) hizlar[nh++] = hiz;
        int gecen = (int)((sn - t0) / 1000);
        con(L"\r  %3d/%d sn  hız %6.1f iş/sn  hesap hatası: %lld  (ESC=durdur)     ", gecen, saniye, hiz, (long long)g_cpuHata);
        if (gecen % 10 == 0) { rep(L"  %d sn: hız %.1f iş/sn, hata %lld\n", gecen, hiz, (long long)g_cpuHata); flush_rep(); }
        if (esc_basildi()) iptal = 1;
        if (gecen >= saniye) break;
    }
    g_cpuDur = 1;
    WaitForMultipleObjects(t, th, TRUE, 30000);
    for (int i = 0; i < t; i++) CloseHandle(th[i]);
    clear_line();
    test_bitti(L"CPU stres testi");
    int sonSic = sicaklik_oku(s2, 256);
    if (s2[0]) pr(L"  Test sonu ACPI sıcaklık: %ls\n", s2);

    /* başlangıç (2-7. sn) ve son 5 sn hız karşılaştırması */
    double bas = 0, son = 0; int nb = 0, ns = 0;
    for (int i = 2; i < nh && i < 8; i++) { bas += hizlar[i]; nb++; }
    for (int i = nh - 5; i < nh; i++) if (i >= 8) { son += hizlar[i]; ns++; }
    if (nb) bas /= nb;
    if (ns) son /= ns;
    pr(L"  Toplam iş: %lld, hesap hatası: %lld\n", (long long)g_cpuIs, (long long)g_cpuHata);
    if (nb && ns) pr(L"  Başlangıç hızı %.1f, son hız %.1f iş/sn (%%%.0f)\n", bas, son, bas > 0 ? son / bas * 100 : 0);

    if (g_cpuHata)
        bulgu(S_HATA, L"İşlemci/RAM/Anakart",
              L"İşlemci yük altında yanlış hesap yapıyor. BIOS'u varsayılana alın (hız aşırtma / XMP kapalı), "
              L"soğutmayı kontrol edin. Devam ederse işlemci, anakart (VRM) veya RAM arızalı.",
              L"CPU stres testinde %lld HESAP HATASI – sistem kararsız!", (long long)g_cpuHata);
    if (nb && ns && bas > 0 && son / bas < 0.70)
        bulgu(S_UYARI, L"Soğutma",
              L"İşlemci ısınınca yavaşlıyor (termal kısma). Fanın döndüğünü, soğutucunun oturduğunu, termal macunu ve tozu kontrol edin.",
              L"CPU hızı test boyunca %%%.0f düştü.", (1 - son / bas) * 100);
    if (sonSic >= 90)
        bulgu(S_UYARI, L"Soğutma", L"Isı çok yüksek; işlemci soğutmasını kontrol edin.", L"Test sonunda sıcaklık %d °C.", sonSic);
    (void)ilkSic;
    if (!g_cpuHata && !(nb && ns && bas > 0 && son / bas < 0.70) && !iptal)
        prc(C_OK, L"  => İşlemci testi: SORUN YOK (sistem test boyunca kararlı kaldı)\n");
}

/* ------------------------------------------------------------------ */
/* Windows kurulumu: çökme dökümleri, günlükler, önyükleme             */
/* ------------------------------------------------------------------ */
typedef struct { DWORD kod; const wchar_t *ad; const wchar_t *parca; } BugCheck;
static const BugCheck g_bc[] = {
    {0x0000001A, L"MEMORY_MANAGEMENT", L"RAM"},
    {0x00000050, L"PAGE_FAULT_IN_NONPAGED_AREA", L"RAM veya sürücü"},
    {0x0000004E, L"PFN_LIST_CORRUPT", L"RAM"},
    {0x00000124, L"WHEA_UNCORRECTABLE_ERROR", L"İşlemci/Anakart/Güç (donanım)"},
    {0x00000101, L"CLOCK_WATCHDOG_TIMEOUT", L"İşlemci/Anakart"},
    {0x0000009C, L"MACHINE_CHECK_EXCEPTION", L"İşlemci/Anakart"},
    {0x0000007B, L"INACCESSIBLE_BOOT_DEVICE", L"Disk / BIOS SATA modu / sürücü"},
    {0x0000007A, L"KERNEL_DATA_INPAGE_ERROR", L"Disk"},
    {0x00000077, L"KERNEL_STACK_INPAGE_ERROR", L"Disk"},
    {0x000000ED, L"UNMOUNTABLE_BOOT_VOLUME", L"Disk"},
    {0x00000154, L"UNEXPECTED_STORE_EXCEPTION", L"Disk"},
    {0x000000F4, L"CRITICAL_OBJECT_TERMINATION", L"Disk"},
    {0x000000EF, L"CRITICAL_PROCESS_DIED", L"Windows (yazılım) veya disk"},
    {0x00000116, L"VIDEO_TDR_FAILURE", L"Ekran kartı"},
    {0x00000117, L"VIDEO_TDR_TIMEOUT_DETECTED", L"Ekran kartı"},
    {0x00000119, L"VIDEO_SCHEDULER_INTERNAL_ERROR", L"Ekran kartı"},
    {0x00000141, L"VIDEO_ENGINE_TIMEOUT_DETECTED", L"Ekran kartı"},
    {0x0000009F, L"DRIVER_POWER_STATE_FAILURE", L"Sürücü (yazılım)"},
    {0x000000D1, L"DRIVER_IRQL_NOT_LESS_OR_EQUAL", L"Sürücü (yazılım) veya RAM"},
    {0x0000000A, L"IRQL_NOT_LESS_OR_EQUAL", L"Sürücü veya RAM"},
    {0x0000003B, L"SYSTEM_SERVICE_EXCEPTION", L"Sürücü (yazılım) veya RAM"},
    {0x0000007E, L"SYSTEM_THREAD_EXCEPTION_NOT_HANDLED", L"Sürücü (yazılım)"},
    {0x0000001E, L"KMODE_EXCEPTION_NOT_HANDLED", L"Sürücü veya RAM"},
    {0x00000133, L"DPC_WATCHDOG_VIOLATION", L"Sürücü / SSD yazılımı"},
    {0x00000139, L"KERNEL_SECURITY_CHECK_FAILURE", L"Sürücü veya RAM"},
    {0x000000C2, L"BAD_POOL_CALLER", L"Sürücü"},
    {0x00000019, L"BAD_POOL_HEADER", L"RAM veya sürücü"},
    {0x000000C5, L"DRIVER_CORRUPTED_EXPOOL", L"Sürücü veya RAM"},
    {0x00000024, L"NTFS_FILE_SYSTEM", L"Disk / dosya sistemi"},
    {0x0000012B, L"FAULTY_HARDWARE_CORRUPTED_PAGE", L"RAM"},
    {0x000001C4, L"DRIVER_VERIFIER_DETECTED_VIOLATION_LIVEDUMP", L"Sürücü"},
    {0x00000000, NULL, NULL}
};

static const BugCheck *bc_bul(DWORD k)
{
    for (int i = 0; g_bc[i].ad; i++) if (g_bc[i].kod == k) return &g_bc[i];
    return NULL;
}

typedef struct { FILETIME t; wchar_t yol[MAX_PATH]; } DosyaT;
static int dosyat_karsilastir(const void *a, const void *b)
{
    return -CompareFileTime(&((const DosyaT *)a)->t, &((const DosyaT *)b)->t);
}

static int g_bcSay[8]; /* 0 RAM,1 Disk,2 CPU,3 GPU,4 Sürücü/Yazılım */

static void dokum_coz(const wchar_t *yol, const FILETIME *ft)
{
    HANDLE h = CreateFileW(yol, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, 0, NULL);
    wchar_t ts[32]; zaman_yaz(ft, ts, 32);
    const wchar_t *dosya = wcsrchr(yol, L'\\'); dosya = dosya ? dosya + 1 : yol;
    if (h == INVALID_HANDLE_VALUE) { pr(L"    %ls  %ls  (açılamadı)\n", ts, dosya); return; }
    BYTE b[0x80] = {0}; DWORD r = 0;
    ReadFile(h, b, sizeof(b), &r, NULL);
    CloseHandle(h);
    DWORD kod = 0; uint64_t p1 = 0, p2 = 0, p3 = 0, p4 = 0; int ok = 0;
    if (r >= 0x60 && !memcmp(b, "PAGEDU64", 8)) {
        kod = *(DWORD *)(b + 0x38);
        p1 = u64le(b + 0x40); p2 = u64le(b + 0x48); p3 = u64le(b + 0x50); p4 = u64le(b + 0x58);
        ok = 1;
    } else if (r >= 0x30 && !memcmp(b, "PAGEDUMP", 8)) {
        kod = *(DWORD *)(b + 0x20);
        p1 = *(DWORD *)(b + 0x24); p2 = *(DWORD *)(b + 0x28); p3 = *(DWORD *)(b + 0x2C); p4 = *(DWORD *)(b + 0x30);
        ok = 1;
    }
    if (!ok) { pr(L"    %ls  %ls  (döküm biçimi tanınmadı)\n", ts, dosya); return; }
    const BugCheck *bc = bc_bul(kod);
    pr(L"    %ls  0x%08lX %-34ls -> %ls\n", ts, kod, bc ? bc->ad : L"(diğer)", bc ? bc->parca : L"?");
    rep(L"        parametreler: %llX %llX %llX %llX  [%ls]\n", (unsigned long long)p1, (unsigned long long)p2,
        (unsigned long long)p3, (unsigned long long)p4, dosya);
    if (kod == 0x7A || kod == 0x77) {
        /* p2 durum kodu: c000009c/c000016a = kötü blok, c0000185 = cihaz bağlantı */
        DWORD st = (DWORD)p2;
        if (st == 0xC000009C || st == 0xC000016A) { pr(L"        durum 0x%08lX = diskte KÖTÜ SEKTÖR\n", st); g_bcSay[1]++; }
        else if (st == 0xC0000185) { pr(L"        durum 0x%08lX = disk BAĞLANTI hatası (kablo/port/disk)\n", st); g_bcSay[1]++; }
        else if (st == 0xC000000E) pr(L"        durum 0x%08lX = disk ERİŞİLEMEZ\n", st);
    }
    if (!bc) return;
    if (wcsstr(bc->parca, L"Ekran")) g_bcSay[3]++;
    else if (!wcscmp(bc->parca, L"RAM")) g_bcSay[0]++;
    else if (wcsstr(bc->parca, L"İşlemci")) g_bcSay[2]++;
    else if (!wcsncmp(bc->parca, L"Disk", 4)) g_bcSay[1]++;
    else g_bcSay[4]++;
}

static void dokumleri_incele(const wchar_t *win)
{
    DosyaT liste[200]; int n = 0;
    wchar_t ara[MAX_PATH]; WIN32_FIND_DATAW fd; HANDLE f;
    swprintf(ara, MAX_PATH, L"%ls\\Minidump\\*.dmp", win);
    f = FindFirstFileW(ara, &fd);
    if (f != INVALID_HANDLE_VALUE) {
        do {
            if (n >= 200) break;
            liste[n].t = fd.ftLastWriteTime;
            swprintf(liste[n].yol, MAX_PATH, L"%ls\\Minidump\\%ls", win, fd.cFileName);
            n++;
        } while (FindNextFileW(f, &fd));
        FindClose(f);
    }
    swprintf(ara, MAX_PATH, L"%ls\\MEMORY.DMP", win);
    f = FindFirstFileW(ara, &fd);
    if (f != INVALID_HANDLE_VALUE && n < 200) {
        liste[n].t = fd.ftLastWriteTime;
        swprintf(liste[n].yol, MAX_PATH, L"%ls\\MEMORY.DMP", win);
        n++;
        FindClose(f);
    }
    memset(g_bcSay, 0, sizeof(g_bcSay));
    if (!n) {
        pr(L"  Mavi ekran (BSOD) dökümü yok.\n");
    } else {
        qsort(liste, n, sizeof(DosyaT), dosyat_karsilastir);
        pr(L"  Mavi ekran dökümleri (%d adet, en yeni 15):\n", n);
        for (int i = 0; i < n && i < 15; i++) dokum_coz(liste[i].yol, &liste[i].t);
        if (g_bcSay[0]) bulgu(g_bcSay[0] >= 2 ? S_HATA : S_UYARI, L"RAM", L"RAM testini çalıştırın; modülleri tek tek deneyin.",
                              L"%d mavi ekran RAM hatasını işaret ediyor.", g_bcSay[0]);
        if (g_bcSay[1]) bulgu(g_bcSay[1] >= 2 ? S_HATA : S_UYARI, L"Disk", L"Disk SMART ve yüzey testine bakın; SATA kablosunu değiştirin.",
                              L"%d mavi ekran DİSK erişim sorununu işaret ediyor.", g_bcSay[1]);
        if (g_bcSay[2]) bulgu(S_HATA, L"İşlemci/Anakart/Güç", L"Donanım hatası (WHEA). BIOS varsayılanlarını yükleyin, hız aşırtmayı kapatın, PSU ve soğutmayı kontrol edin.",
                              L"%d mavi ekran İŞLEMCİ/ANAKART donanım hatası (WHEA/MCE).", g_bcSay[2]);
        if (g_bcSay[3]) bulgu(S_UYARI, L"Ekran kartı", L"Ekran kartını çıkarıp (varsa) dahili grafikle deneyin; ekran kartı sürücüsü de olabilir.",
                              L"%d mavi ekran EKRAN KARTI zaman aşımı.", g_bcSay[3]);
        if (g_bcSay[4]) bulgu(S_UYARI, L"Windows (yazılım)", L"Güvenli Mod / Sistem Geri Yükleme / son güncellemeyi kaldırma deneyin.",
                              L"%d mavi ekran sürücü/yazılım kaynaklı görünüyor.", g_bcSay[4]);
    }
    /* LiveKernelReports – donanım zaman aşımı raporları */
    swprintf(ara, MAX_PATH, L"%ls\\LiveKernelReports\\*", win);
    f = FindFirstFileW(ara, &fd);
    if (f != INVALID_HANDLE_VALUE) {
        int baslikYazildi = 0;
        do {
            if (!(fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) || fd.cFileName[0] == L'.') continue;
            wchar_t alt[MAX_PATH]; WIN32_FIND_DATAW fd2;
            swprintf(alt, MAX_PATH, L"%ls\\LiveKernelReports\\%ls\\*.dmp", win, fd.cFileName);
            HANDLE f2 = FindFirstFileW(alt, &fd2);
            int say = 0; FILETIME son = {0, 0};
            if (f2 != INVALID_HANDLE_VALUE) {
                do { say++; if (CompareFileTime(&fd2.ftLastWriteTime, &son) > 0) son = fd2.ftLastWriteTime; } while (FindNextFileW(f2, &fd2));
                FindClose(f2);
            }
            if (!say) continue;
            if (!baslikYazildi) { pr(L"  Canlı çekirdek raporları (donanım zaman aşımı):\n"); baslikYazildi = 1; }
            wchar_t ts[32]; zaman_yaz(&son, ts, 32);
            pr(L"    %-24ls %d adet, son: %ls\n", fd.cFileName, say, ts);
            if (!_wcsicmp(fd.cFileName, L"WATCHDOG") && say >= 2)
                bulgu(S_UYARI, L"Ekran kartı", L"Ekran kartı/sürücüsü defalarca yanıt vermemiş; kartı çıkarıp dahili grafikle deneyin.",
                      L"%d ekran kartı WATCHDOG (TDR) raporu var.", say);
        } while (FindNextFileW(f, &fd));
        FindClose(f);
    }
}

static void srt_incele(const wchar_t *win)
{
    wchar_t yol[MAX_PATH];
    swprintf(yol, MAX_PATH, L"%ls\\System32\\LogFiles\\Srt\\SrtTrail.txt", win);
    HANDLE h = CreateFileW(yol, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, 0, NULL);
    if (h == INVALID_HANDLE_VALUE) return;
    DWORD sz = GetFileSize(h, NULL);
    if (sz > 4 << 20) sz = 4 << 20;
    char *b = (char *)malloc(sz + 2); DWORD r = 0;
    ReadFile(h, b, sz, &r, NULL);
    CloseHandle(h);
    wchar_t *w = metne_cevir(b, r, CP_ACP);
    free(b);
    pr(L"  Başlangıç Onarma kaydı (SrtTrail.txt) – önemli satırlar:\n");
    wchar_t *satirlar[400]; int n = 0;
    wchar_t *ctx = NULL;
    for (wchar_t *s = wcstok_s(w, L"\r\n", &ctx); s; s = wcstok_s(NULL, L"\r\n", &ctx)) {
        wchar_t up[512]; wcsncpy(up, s, 511); up[511] = 0; _wcsupr(up);
        if (wcsstr(up, L"ROOT CAUSE") || wcsstr(up, L"KÖK NEDEN") || wcsstr(up, L"BOOT STATUS") ||
            wcsstr(up, L"ÖNYÜKLEME DURUMU") || wcsstr(up, L"REPAIR ACTION") || wcsstr(up, L"ONARIM EYLEMİ") ||
            wcsstr(up, L"BOOT CRITICAL FILE") || wcsstr(up, L"ÖNYÜKLEME İÇİN KRİTİK") || wcsstr(up, L"CORRUPT") ||
            wcsstr(up, L"BOZUK")) {
            if (n < 400) satirlar[n++] = s; else { memmove(satirlar, satirlar + 1, 399 * sizeof(wchar_t *)); satirlar[399] = s; }
        }
    }
    int bas = n > 14 ? n - 14 : 0;
    for (int i = bas; i < n; i++) { wchar_t t[400]; wcsncpy(t, satirlar[i], 399); t[399] = 0; trim(t); pr(L"    %ls\n", t); }
    if (!n) pr(L"    (önemli satır yok)\n");
    for (int i = bas; i < n; i++) {
        wchar_t up[512]; wcsncpy(up, satirlar[i], 511); up[511] = 0; _wcsupr(up);
        if ((wcsstr(up, L"ROOT CAUSE") || wcsstr(up, L"KÖK NEDEN")) && (wcsstr(up, L"CORRUPT") || wcsstr(up, L"BOZUK"))) {
            bulgu(S_UYARI, L"Windows (yazılım)", L"Kritik Windows dosyası bozuk. Disk testi temizse: komut isteminde sfc /scannow /offbootdir=C:\\ /offwindir=C:\\Windows ya da onarım/temiz kurulum.",
                  L"Başlangıç Onarma bozuk bir dosya bulmuş: %ls", satirlar[i]);
            break;
        }
    }
    free(w);
}

static void olay_gunlugu(const wchar_t *win)
{
    wchar_t wev[MAX_PATH];
    wchar_t log[MAX_PATH];
    swprintf(log, MAX_PATH, L"%ls\\System32\\winevt\\Logs\\System.evtx", win);
    if (!dosya_var(log)) { pr(L"  Sistem olay günlüğü bulunamadı.\n"); return; }
    if (!sistem_araci(L"wevtutil.exe", wev, MAX_PATH)) { pr(L"  wevtutil bu ortamda yok; olay günlüğü atlandı.\n"); return; }
    wchar_t cmd[1400];
    swprintf(cmd, 1400,
             L"\"%ls\" qe \"%ls\" /lf:true /rd:true /c:400 /f:text "
             L"/q:\"*[System[(EventID=41 or EventID=6008 or EventID=1001 or EventID=7 or EventID=11 or EventID=51 "
             L"or EventID=55 or EventID=98 or EventID=129 or EventID=153 or EventID=157 or "
             L"Provider[@Name='Microsoft-Windows-WHEA-Logger'])]]\"",
             wev, log);
    con(L"  Olay günlüğü okunuyor...");
    wchar_t *o = komut_calistir(cmd, 60000);
    clear_line();
    if (!o) { pr(L"  Olay günlüğü okunamadı.\n"); return; }
    struct { int id; const wchar_t *kaynak; const wchar_t *ad; int say; wchar_t son[40]; } s[] = {
        {41, L"Kernel-Power", L"Beklenmedik kapanma/yeniden başlama", 0, L""},
        {6008, NULL, L"Önceki kapanma beklenmedikti", 0, L""},
        {1001, NULL, L"Mavi ekran (BugCheck)", 0, L""},
        {7, NULL, L"Diskte KÖTÜ BLOK", 0, L""},
        {11, NULL, L"Disk denetleyici hatası", 0, L""},
        {51, NULL, L"Sayfalama sırasında disk hatası", 0, L""},
        {129, NULL, L"Disk sıfırlandı (yanıt vermedi)", 0, L""},
        {153, NULL, L"Disk G/Ç tekrar denendi", 0, L""},
        {157, NULL, L"Disk aniden çıkarıldı", 0, L""},
        {55, NULL, L"NTFS dosya sistemi bozuk", 0, L""},
        {98, NULL, L"Birim onarım gerektiriyor", 0, L""},
        {-1, L"WHEA", L"Donanım hatası (WHEA)", 0, L""},
    };
    int ns = (int)(sizeof(s) / sizeof(s[0]));
    int whea18 = 0, whea19 = 0, whea47 = 0, whea17 = 0;
    wchar_t kaynak[256] = L"", tarih[64] = L"";
    wchar_t *ctx = NULL;
    for (wchar_t *l = wcstok_s(o, L"\r\n", &ctx); l; l = wcstok_s(NULL, L"\r\n", &ctx)) {
        wchar_t *p = l; while (*p == L' ') p++;
        if (!wcsncmp(p, L"Source:", 7) || !wcsncmp(p, L"Kaynak:", 7)) { wcsncpy(kaynak, p + 7, 255); kaynak[255] = 0; trim(kaynak); }
        else if (!wcsncmp(p, L"Date:", 5) || !wcsncmp(p, L"Tarih:", 6)) { wcsncpy(tarih, wcschr(p, L':') + 1, 63); tarih[63] = 0; trim(tarih); }
        else if (!wcsncmp(p, L"Event ID:", 9) || !wcsncmp(p, L"Olay Kimliği:", 13)) {
            int id = _wtoi(wcschr(p, L':') + 1);
            int whea = wcsstr(kaynak, L"WHEA") != NULL;
            for (int i = 0; i < ns; i++) {
                int eslesti = 0;
                if (s[i].id == -1) eslesti = whea;
                else if (!whea && s[i].id == id) eslesti = (id != 41) || wcsstr(kaynak, L"Kernel-Power");
                if (eslesti) { if (!s[i].say) { wcsncpy(s[i].son, tarih, 39); s[i].son[39] = 0; } s[i].say++; }
            }
            if (whea) { if (id == 18) whea18++; else if (id == 19) whea19++; else if (id == 47) whea47++; else if (id == 17) whea17++; }
        }
    }
    free(o);
    pr(L"  Sistem olay günlüğü (son 400 ilgili olay):\n");
    int hic = 1;
    for (int i = 0; i < ns; i++) if (s[i].say) {
        hic = 0;
        pr(L"    %-38ls : %4d  (en son %ls)\n", s[i].ad, s[i].say, s[i].son);
    }
    if (hic) prc(C_OK, L"    İlgili donanım olayı yok.\n");
    int diskOlay = s[3].say + s[4].say + s[5].say + s[6].say + s[8].say;
    if (diskOlay >= 3)
        bulgu(S_HATA, L"Disk", L"Windows diskte okuma/bağlantı hataları kaydetmiş. Disk testine bakın; SATA kablosunu/portunu değiştirin.",
              L"Olay günlüğünde %d disk hatası (kötü blok / denetleyici / sıfırlama).", diskOlay);
    else if (diskOlay > 0 || s[7].say >= 5)
        bulgu(S_UYARI, L"Disk", L"Disk ve kablo bağlantısını kontrol edin.", L"Olay günlüğünde %d disk uyarısı.", diskOlay + s[7].say);
    if (whea18 || whea19 + whea47 >= 3)
        bulgu(whea18 ? S_HATA : S_UYARI, L"İşlemci/Anakart/Güç",
              L"WHEA donanım hatası: BIOS varsayılanları, hız aşırtma/XMP kapatma, PSU ve soğutma kontrolü. Sürerse CPU/anakart.",
              L"WHEA donanım hatası: %d ölümcül, %d düzeltilmiş (CPU/bellek denetleyici).", whea18, whea19 + whea47);
    if (whea17 >= 5)
        bulgu(S_UYARI, L"Anakart/PCIe", L"PCIe hataları: ekran kartı/NVMe yuvasını yeniden oturtun.",
              L"%d PCIe düzeltilmiş hata kaydı.", whea17);
    if (s[0].say >= 3)
        bulgu(S_UYARI, L"Güç kaynağı / çökme", L"Sık beklenmedik kapanma: güç kaynağı, ısınma veya mavi ekran. Mavi ekran dökümü yoksa önce PSU'yu düşünün.",
              L"%d kez beklenmedik kapanma (Kernel-Power 41).", s[0].say);
    if (s[9].say + s[10].say > 0)
        bulgu(S_UYARI, L"Windows (yazılım)", L"Dosya sistemi bozuk: disk testi temizse komut isteminde chkdsk C: /f çalıştırın.",
              L"NTFS dosya sistemi bozulması kaydedilmiş (%d).", s[9].say + s[10].say);
}

static int64_t dosya_tamamen_oku(const wchar_t *yol, int *hata)
{
    *hata = 0;
    HANDLE h = CreateFileW(yol, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE, NULL, OPEN_EXISTING, FILE_FLAG_SEQUENTIAL_SCAN, NULL);
    if (h == INVALID_HANDLE_VALUE) { *hata = (int)GetLastError(); return -1; }
    static BYTE b[1 << 20];
    int64_t top = 0; DWORD r;
    for (;;) {
        if (!ReadFile(h, b, sizeof(b), &r, NULL)) { *hata = (int)GetLastError(); break; }
        if (!r) break;
        top += r;
    }
    CloseHandle(h);
    return top;
}

static int g_winSay = 0;

static void windows_kontrol(void)
{
    baslik(L"6) WINDOWS KURULUMU, ÇÖKME KAYITLARI");
    g_winSay = 0;
    for (wchar_t c = L'C'; c <= L'Z'; c++) {
        if (c == L'X' || c == g_toolDrive) continue;
        wchar_t win[16]; swprintf(win, 16, L"%lc:\\Windows", c);
        wchar_t sys[MAX_PATH]; swprintf(sys, MAX_PATH, L"%ls\\System32\\config\\SYSTEM", win);
        if (!dosya_var(sys)) continue;
        g_winSay++;
        ULARGE_INTEGER bos, top;
        wchar_t kok[8]; swprintf(kok, 8, L"%lc:\\", c);
        GetDiskFreeSpaceExW(kok, &bos, &top, NULL);
        wchar_t etiket[64] = L"";
        GetVolumeInformationW(kok, etiket, 64, NULL, NULL, NULL, NULL, 0);
        pr(L"\n  Windows bulundu: %ls  (etiket \"%ls\", %.1f / %.1f GB boş)\n", win, etiket,
           bos.QuadPart / 1e9, top.QuadPart / 1e9);
        if (top.QuadPart && bos.QuadPart < 1500000000ull)
            bulgu(S_UYARI, L"Windows (yazılım)", L"Disk doldu; Windows güncellemesi/açılış başarısız olabilir. Yer açın.",
                  L"%lc: sürücüsünde yalnızca %.1f GB boş alan var.", c, bos.QuadPart / 1e9);

        const wchar_t *kritik[] = {
            L"System32\\ntoskrnl.exe", L"System32\\hal.dll", L"System32\\winload.efi", L"System32\\winload.exe",
            L"System32\\config\\SYSTEM", L"System32\\config\\SOFTWARE", L"System32\\config\\SAM",
            L"System32\\drivers\\ntfs.sys", L"System32\\ci.dll", NULL };
        pr(L"  Kritik dosyalar:\n");
        for (int i = 0; kritik[i]; i++) {
            wchar_t p[MAX_PATH]; swprintf(p, MAX_PATH, L"%ls\\%ls", win, kritik[i]);
            int64_t boy = dosya_boyu(p);
            if (boy < 0) {
                pr(L"    %-30ls YOK\n", kritik[i]);
                bulgu(S_HATA, L"Windows (yazılım)", L"Kritik Windows dosyası eksik: Başlangıç onarma / sfc offline / yeniden kurulum.",
                      L"%ls\\%ls eksik.", win, kritik[i]);
                continue;
            }
            int hata = 0;
            int64_t okunan = dosya_tamamen_oku(p, &hata);
            if (hata == ERROR_CRC || hata == ERROR_IO_DEVICE || hata == 1117 /*ERROR_IO_DEVICE*/ || hata == 483 /*ERROR_DEVICE_HARDWARE_ERROR*/) {
                prc(C_ERR, L"    %-30ls OKUNAMADI (disk hatası %d)\n", kritik[i], hata);
                bulgu(S_HATA, L"Disk", L"Windows'un açılış dosyası diskten okunamıyor: DİSK ARIZALI.", L"%ls okunurken disk hatası.", kritik[i]);
            } else if (boy == 0) {
                prc(C_ERR, L"    %-30ls 0 bayt!\n", kritik[i]);
                bulgu(S_HATA, L"Windows (yazılım)", L"Kayıt defteri/sistem dosyası boş: dosya sistemi bozulmuş. chkdsk ve onarım gerekir; disk testini de kontrol edin.",
                      L"%ls boyutu 0.", kritik[i]);
            } else {
                pr(L"    %-30ls tamam (%.1f MB)\n", kritik[i], boy / 1048576.0);
                (void)okunan;
            }
        }
        dokumleri_incele(win);
        srt_incele(win);
        olay_gunlugu(win);
        flush_rep();
    }
    if (!g_winSay) {
        pr(L"  Hiçbir sürücüde Windows kurulumu bulunamadı.\n");
        int dahiliVar = 0;
        for (int i = 0; i < g_nd; i++) if (dahili(&g_d[i])) dahiliVar = 1;
        if (dahiliVar)
            bulgu(S_UYARI, L"Disk / Windows",
                  L"Disk görünüyor ama Windows bölümü okunamıyor ya da harf atanmamış (BitLocker şifreli olabilir). "
                  L"BitLocker ise bu kontrol yapılamaz; disk testleri yine de geçerlidir.",
                  L"Dahili diskte erişilebilir Windows klasörü bulunamadı.");
    }
}

/* --- Önyükleme yapılandırması --- */
static const GUID G_ESP = {0xc12a7328, 0xf81f, 0x11d2, {0xba, 0x4b, 0x00, 0xa0, 0xc9, 0x3e, 0xc9, 0x3b}};
static const GUID G_MSR = {0xe3c9e316, 0x0b5c, 0x4db8, {0x81, 0x7d, 0xf9, 0x2d, 0xf0, 0x02, 0x15, 0xae}};
static const GUID G_DATA = {0xebd0a0a2, 0xb9e5, 0x4433, {0x87, 0xc0, 0x68, 0xb6, 0xb7, 0x26, 0x99, 0xc7}};
static const GUID G_REC = {0xde94bba4, 0x06d1, 0x4d40, {0xa1, 0x6a, 0xbf, 0xd5, 0x01, 0x79, 0xd6, 0xac}};

static void bcd_incele(const wchar_t *bcdYol, const wchar_t *ne)
{
    wchar_t tmp[MAX_PATH], kopya[MAX_PATH], bcdedit[MAX_PATH];
    GetTempPathW(MAX_PATH, tmp);
    swprintf(kopya, MAX_PATH, L"%lsteshis_bcd_kopya", tmp);
    DeleteFileW(kopya);
    if (!CopyFileW(bcdYol, kopya, FALSE)) { pr(L"      BCD kopyalanamadı (hata %lu)\n", GetLastError()); return; }
    if (!sistem_araci(L"bcdedit.exe", bcdedit, MAX_PATH)) { DeleteFileW(kopya); return; }
    wchar_t cmd[1024];
    swprintf(cmd, 1024, L"\"%ls\" /store \"%ls\" /enum all", bcdedit, kopya);
    wchar_t *o = komut_calistir(cmd, 20000);
    DeleteFileW(kopya);
    if (!o) return;
    int yukleyici = 0, bilinmeyen = 0;
    rep(L"      --- %ls BCD içeriği ---\n", ne);
    wchar_t *ctx = NULL;
    for (wchar_t *l = wcstok_s(o, L"\r\n", &ctx); l; l = wcstok_s(NULL, L"\r\n", &ctx)) {
        rep(L"      %ls\n", l);
        if (wcsstr(l, L"winload")) yukleyici++;
        if ((wcsstr(l, L"device") || wcsstr(l, L"osdevice") || wcsstr(l, L"aygıt")) && wcsstr(l, L"unknown")) bilinmeyen++;
    }
    pr(L"      BCD: %d Windows yükleyici kaydı%ls\n", yukleyici, bilinmeyen ? L", BİLİNMEYEN aygıt kaydı var" : L"");
    if (!yukleyici)
        bulgu(S_HATA, L"Windows (önyükleme)", L"Önyükleme kaydı yok/bozuk: komut isteminde  bcdboot C:\\Windows  çalıştırın (C: Windows'un harfi).",
              L"BCD önyükleme deposunda Windows kaydı yok.");
    else if (bilinmeyen)
        bulgu(S_UYARI, L"Windows (önyükleme)", L"BCD aygıt kaydı bozuk: komut isteminde  bcdboot C:\\Windows  ile yeniden oluşturun.",
              L"BCD'de \"unknown\" aygıt kaydı var.");
    free(o);
}

static void onyukleme_kontrol(void)
{
    baslik(L"7) ÖNYÜKLEME (BCD / EFI) YAPILANDIRMASI");
    if (!g_nd) diskleri_bul();
    if (!g_firmware) {
        typedef BOOL (WINAPI *GFT)(PDWORD);
        GFT gft = (GFT)(void *)GetProcAddress(GetModuleHandleW(L"kernel32.dll"), "GetFirmwareType");
        DWORD ft = 0; if (gft && gft(&ft)) g_firmware = (int)ft;
    }
    int bulunanEsp = 0;
    for (int i = 0; i < g_nd; i++) {
        Disk *d = &g_d[i];
        if (!dahili(d)) continue;
        HANDLE h = disk_ac(d->no, 0, 0);
        if (h == INVALID_HANDLE_VALUE) continue;
        DWORD sz = 64 * 1024; BYTE *b = (BYTE *)malloc(sz); DWORD r;
        if (!DeviceIoControl(h, IOCTL_DISK_GET_DRIVE_LAYOUT_EX, NULL, 0, b, sz, &r, NULL)) { free(b); CloseHandle(h); continue; }
        CloseHandle(h);
        DRIVE_LAYOUT_INFORMATION_EX *li = (DRIVE_LAYOUT_INFORMATION_EX *)b;
        const wchar_t *stil = li->PartitionStyle == PARTITION_STYLE_GPT ? L"GPT" : li->PartitionStyle == PARTITION_STYLE_MBR ? L"MBR" : L"Bölümsüz";
        pr(L"  Disk %d (%ls) bölüm stili: %ls\n", d->no, d->model, stil);
        int esp = 0, aktif = 0, ntfs = 0;
        for (DWORD k = 0; k < li->PartitionCount; k++) {
            PARTITION_INFORMATION_EX *pi = &li->PartitionEntry[k];
            if (!pi->PartitionLength.QuadPart) continue;
            wchar_t bs[32]; boyut_yaz((uint64_t)pi->PartitionLength.QuadPart, bs, 32);
            const wchar_t *tur = L"diğer";
            if (pi->PartitionStyle == PARTITION_STYLE_GPT) {
                const GUID *g = &pi->Gpt.PartitionType;
                if (IsEqualGUID(g, &G_ESP)) { tur = L"EFI sistem bölümü"; esp = (int)pi->PartitionNumber; }
                else if (IsEqualGUID(g, &G_MSR)) tur = L"MSR";
                else if (IsEqualGUID(g, &G_DATA)) { tur = L"Veri (NTFS/FAT)"; ntfs++; }
                else if (IsEqualGUID(g, &G_REC)) tur = L"Kurtarma";
            } else if (pi->PartitionStyle == PARTITION_STYLE_MBR) {
                BYTE t = pi->Mbr.PartitionType;
                if (t == 0x07) { tur = L"NTFS"; ntfs++; }
                else if (t == 0x27) tur = L"Kurtarma";
                else if (t == 0x0B || t == 0x0C) tur = L"FAT32";
                else if (t == 0xEE) tur = L"GPT koruma";
                if (pi->Mbr.BootIndicator) aktif = (int)pi->PartitionNumber;
            }
            pr(L"    Bölüm %lu: %-20ls %ls%ls\n", pi->PartitionNumber, tur, bs,
               (pi->PartitionStyle == PARTITION_STYLE_MBR && pi->Mbr.BootIndicator) ? L"  [AKTİF]" : L"");
        }
        if (li->PartitionStyle == PARTITION_STYLE_GPT) {
            if (esp) {
                bulunanEsp++;
                wchar_t kok[MAX_PATH], p[MAX_PATH];
                swprintf(kok, MAX_PATH, L"\\\\?\\GLOBALROOT\\Device\\Harddisk%d\\Partition%d", d->no, esp);
                swprintf(p, MAX_PATH, L"%ls\\EFI\\Microsoft\\Boot\\bootmgfw.efi", kok);
                int bm = dosya_var(p);
                swprintf(p, MAX_PATH, L"%ls\\EFI\\Microsoft\\Boot\\BCD", kok);
                int bcd = dosya_var(p);
                pr(L"    EFI: bootmgfw.efi %ls, BCD %ls\n", bm ? L"var" : L"YOK", bcd ? L"var" : L"YOK");
                if (ntfs && (!bm || !bcd))
                    bulgu(S_HATA, L"Windows (önyükleme)", L"EFI önyükleme dosyaları eksik: komut isteminde  bcdboot C:\\Windows /f UEFI  çalıştırın.",
                          L"Disk %d EFI bölümünde Windows önyükleme dosyaları eksik.", d->no);
                if (bcd) bcd_incele(p, L"EFI");
            } else if (ntfs) {
                bulgu(S_UYARI, L"Windows (önyükleme)", L"GPT diskte EFI bölümü yok: önyükleme bölümü silinmiş olabilir. bcdboot ile yeniden oluşturulmalı.",
                      L"Disk %d GPT ama EFI sistem bölümü yok.", d->no);
            }
            if (g_firmware == FT_BIOS && ntfs)
                bulgu(S_UYARI, L"BIOS ayarı", L"Disk GPT (UEFI) ama bilgisayar Legacy/CSM modunda açılmış. BIOS'ta UEFI önyükleme modunu seçin (CMOS pili bitip ayarlar sıfırlanmış olabilir).",
                      L"Disk %d GPT, ancak açılış modu Legacy BIOS.", d->no);
        } else if (li->PartitionStyle == PARTITION_STYLE_MBR) {
            if (aktif) {
                wchar_t p[MAX_PATH];
                swprintf(p, MAX_PATH, L"\\\\?\\GLOBALROOT\\Device\\Harddisk%d\\Partition%d\\bootmgr", d->no, aktif);
                int bm = dosya_var(p);
                swprintf(p, MAX_PATH, L"\\\\?\\GLOBALROOT\\Device\\Harddisk%d\\Partition%d\\Boot\\BCD", d->no, aktif);
                int bcd = dosya_var(p);
                pr(L"    Aktif bölüm: bootmgr %ls, Boot\\BCD %ls\n", bm ? L"var" : L"YOK", bcd ? L"var" : L"YOK");
                if (ntfs && (!bm || !bcd))
                    bulgu(S_HATA, L"Windows (önyükleme)", L"Önyükleme dosyaları eksik: komut isteminde  bcdboot C:\\Windows /f BIOS  çalıştırın.",
                          L"Disk %d aktif bölümünde bootmgr/BCD eksik.", d->no);
                if (bcd) bcd_incele(p, L"MBR");
            } else if (ntfs) {
                bulgu(S_UYARI, L"Windows (önyükleme)", L"MBR diskte aktif bölüm yok: diskpart ile sistem bölümünü 'active' yapın ya da bcdboot kullanın.",
                      L"Disk %d MBR ama aktif bölüm yok.", d->no);
            }
            if (g_firmware == FT_UEFI && ntfs)
                bulgu(S_UYARI, L"BIOS ayarı", L"Disk MBR (eski BIOS) ama bilgisayar UEFI modunda. BIOS'ta CSM/Legacy desteğini açın (CMOS pili bitip ayarlar sıfırlanmış olabilir).",
                      L"Disk %d MBR, ancak açılış modu UEFI.", d->no);
        }
        free(b);
    }
    (void)bulunanEsp;
}

/* ------------------------------------------------------------------ */
/* Özet                                                                */
/* ------------------------------------------------------------------ */
static void ozet(void)
{
    baslik(L"SONUÇ – OLASI ARIZALI PARÇALAR");
    int hata = 0, uyari = 0;
    for (int i = 0; i < g_nb; i++) { if (g_b[i].sev == S_HATA) hata++; else if (g_b[i].sev == S_UYARI) uyari++; }

    /* parça bazında grupla */
    wchar_t parcalar[64][48]; int psev[64], pn = 0;
    for (int i = 0; i < g_nb; i++) {
        if (g_b[i].sev == S_BILGI) continue;
        int k = -1;
        for (int j = 0; j < pn; j++) if (!wcscmp(parcalar[j], g_b[i].parca)) k = j;
        if (k < 0 && pn < 64) { k = pn++; wcscpy(parcalar[k], g_b[i].parca); psev[k] = 0; }
        if (k >= 0 && g_b[i].sev > psev[k]) psev[k] = g_b[i].sev;
    }
    if (!hata && !uyari) {
        prc(C_OK, L"\n  Yapılan testlerde DONANIM SORUNU BULUNAMADI.\n\n");
        pr(L"  Bilgisayar BIOS'a ve Windows kurulumuna girebildiğine göre işlemci,\n"
           L"  anakart, RAM ve ekran temel olarak çalışıyor; disk de sağlam göründüğüne\n"
           L"  göre sorun büyük olasılıkla YAZILIMSAL (bozuk güncelleme, sürücü,\n"
           L"  önyükleme kaydı). Öneriler:\n"
           L"   1) Kurulum ekranında \"Bilgisayarınızı onarın\" > Sorun Gider >\n"
           L"      Başlangıç Onarma / Güncelleştirmeleri Kaldır / Sistem Geri Yükleme\n"
           L"   2) Komut isteminde:  bcdboot C:\\Windows   ve\n"
           L"      sfc /scannow /offbootdir=C:\\ /offwindir=C:\\Windows\n"
           L"   3) Olmazsa verileri yedekleyip temiz kurulum.\n");
    } else {
        for (int pass = S_HATA; pass >= S_UYARI; pass--) {
            for (int j = 0; j < pn; j++) {
                if (psev[j] != pass) continue;
                prc(pass == S_HATA ? C_ERR : C_WARN, L"\n  %ls %ls\n", pass == S_HATA ? L"[ARIZALI / ÇOK OLASI]" : L"[ŞÜPHELİ]", parcalar[j]);
                const wchar_t *sonOneri = L"";
                for (int i = 0; i < g_nb; i++) {
                    if (wcscmp(g_b[i].parca, parcalar[j]) || g_b[i].sev == S_BILGI) continue;
                    pr(L"     - %ls\n", g_b[i].mesaj);
                    if (g_b[i].oneri[0] && wcscmp(sonOneri, g_b[i].oneri)) {
                        prc(C_DIM, L"       Öneri: %ls\n", g_b[i].oneri);
                        sonOneri = g_b[i].oneri;
                    }
                }
            }
        }
    }
    int bilgi = 0;
    for (int i = 0; i < g_nb; i++) if (g_b[i].sev == S_BILGI) { if (!bilgi++) pr(L"\n  Bilgi:\n"); pr(L"     - %ls\n", g_b[i].mesaj); }
    pr(L"\n  Bu aracın doğrudan ölçemediği parçalar: GÜÇ KAYNAĞI ve EKRAN KARTI.\n"
       L"   - CPU stres testi sırasında kapanma/yeniden başlama  -> güç kaynağı / soğutma\n"
       L"   - Ekranda bozuk desen, renkli çizgi                   -> ekran kartı\n"
       L"   - Windows logosunda donup sonra kapanma, disk temiz   -> RAM, güç veya yazılım\n");
    prc(C_HEAD, L"\n  Rapor dosyası: %ls\n", g_repPath);
    flush_rep();
}

/* ------------------------------------------------------------------ */
/* Ana program                                                         */
/* ------------------------------------------------------------------ */
static void rapor_ac(void)
{
    SYSTEMTIME st; GetLocalTime(&st);
    wchar_t klasor[MAX_PATH];
    swprintf(klasor, MAX_PATH, L"%ls\\raporlar", g_dir);
    CreateDirectoryW(klasor, NULL);
    swprintf(g_repPath, MAX_PATH, L"%ls\\rapor_%04d%02d%02d_%02d%02d%02d.txt", klasor,
             st.wYear, st.wMonth, st.wDay, st.wHour, st.wMinute, st.wSecond);
    g_rep = CreateFileW(g_repPath, GENERIC_WRITE, FILE_SHARE_READ, NULL, CREATE_ALWAYS, 0, NULL);
    if (g_rep == INVALID_HANDLE_VALUE) {
        wchar_t tmp[MAX_PATH]; GetTempPathW(MAX_PATH, tmp);
        swprintf(g_repPath, MAX_PATH, L"%lsrapor_%04d%02d%02d_%02d%02d%02d.txt", tmp,
                 st.wYear, st.wMonth, st.wDay, st.wHour, st.wMinute, st.wSecond);
        g_rep = CreateFileW(g_repPath, GENERIC_WRITE, FILE_SHARE_READ, NULL, CREATE_ALWAYS, 0, NULL);
    }
    if (g_rep != INVALID_HANDLE_VALUE) {
        DWORD w; WriteFile(g_rep, "\xEF\xBB\xBF", 3, &w, NULL);
        rep(L"Donanım Teşhis Aracı %ls – Rapor\nTarih: %02d.%02d.%04d %02d:%02d\n", SURUM,
            st.wDay, st.wMonth, st.wYear, st.wHour, st.wMinute);
    }
}

static void hepsini_calistir(int ramGecis, int cpuSn)
{
    sistem_bilgisi();
    smart_kontrol();
    onyukleme_kontrol();
    windows_kontrol();
    disk_testleri(0, 0);
    ram_testi(ramGecis);
    cpu_testi(cpuSn);
    ozet();
}

/* Tek tuş okur; girdi bir dosya/boru ise satır satır okur. */
static int tus_oku(void)
{
    DWORD m;
    if (GetConsoleMode(GetStdHandle(STD_INPUT_HANDLE), &m)) {
        int c = _getwch();
        if (c == 0 || c == 0xE0) { _getwch(); return -1; }
        return c;
    }
    for (;;) {
        wint_t c = fgetwc(stdin);
        if (c == WEOF) return '0';
        if (c != L'\n' && c != L'\r') return (int)c;
    }
}

static int menu_sec(void)
{
    prc(C_HEAD, L"\n---------------------------- MENÜ ----------------------------\n");
    con(L"  1) OTOMATİK TAM KONTROL (önerilen, ~10-20 dk)\n"
        L"  2) Sistem bilgisi (anakart, BIOS, RAM yuvaları)\n"
        L"  3) Disk sağlığı (SMART)\n"
        L"  4) Disk yüzey testi – hızlı\n"
        L"  5) Disk yüzey testi – TAM (uzun sürer)\n"
        L"  6) RAM testi (3 geçiş)\n"
        L"  7) RAM testi – uzun (10 geçiş)\n"
        L"  8) İşlemci stres testi (3 dk)\n"
        L"  9) İşlemci stres testi – uzun (15 dk)\n"
        L"  W) Windows kurulumu, mavi ekran ve olay kayıtları\n"
        L"  B) Önyükleme (BCD/EFI) yapılandırması\n"
        L"  S) Sonuç özeti\n"
        L"  R) Raporu Not Defteri'nde aç\n"
        L"  0) Çıkış\n"
        L"  Seçiminiz: ");
    int c = tus_oku();
    if (c < 0) return -1;
    con(L"%lc\n", (wchar_t)c);
    return towupper((wint_t)c);
}

/* Ctrl+C / pencere kapatma: "test sırasında kapandı" yanlış alarmını önle */
static BOOL WINAPI ctrl_isleyici(DWORD tip)
{
    (void)tip;
    wchar_t p[MAX_PATH]; swprintf(p, MAX_PATH, L"%ls\\son_test.txt", g_dir);
    DeleteFileW(p);
    rep(L"\n[Kullanıcı programı kapattı]\n");
    flush_rep();
    return FALSE;
}

int wmain(int argc, wchar_t **argv)
{
    g_out = GetStdHandle(STD_OUTPUT_HANDLE);
    DWORD mode;
    g_console = GetConsoleMode(g_out, &mode);
    SetConsoleOutputCP(65001);
    SetErrorMode(SEM_FAILCRITICALERRORS | SEM_NOOPENFILEERRORBOX);

    GetModuleFileNameW(NULL, g_dir, MAX_PATH);
    wchar_t *sl = wcsrchr(g_dir, L'\\');
    if (sl) *sl = 0;
    arac_diski_bul();
    rapor_ac();
    SetConsoleCtrlHandler(ctrl_isleyici, TRUE);

    if (g_console) {
        SetConsoleTitleW(L"Donanım Teşhis Aracı");
        COORD c = {100, 3000};
        SetConsoleScreenBufferSize(g_out, c);
    }
    prc(C_HEAD, L"==============================================================\n");
    prc(C_HEAD, L"   DONANIM TEŞHİS ARACI %ls  –  açılmayan bilgisayarlar için\n", SURUM);
    prc(C_HEAD, L"==============================================================\n");
    pr(L"  Bu araç diske HİÇBİR ŞEY YAZMAZ; yalnızca okur ve test eder.\n");
    pr(L"  Rapor: %ls\n", g_repPath);

    BOOL yonetici = FALSE;
    {
        HANDLE t; TOKEN_ELEVATION e; DWORD r;
        if (OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &t)) {
            if (GetTokenInformation(t, TokenElevation, &e, sizeof(e), &r)) yonetici = e.TokenIsElevated;
            CloseHandle(t);
        }
    }
    if (!yonetici)
        prc(C_WARN, L"  ! Yönetici yetkisi yok: disk testleri çalışmayabilir.\n"
                    L"    (Windows kurulum ortamında bu sorun olmaz.)\n");

    onceki_kapanma_kontrol();

    int otomatik = 0;
    for (int i = 1; i < argc; i++) if (!_wcsicmp(argv[i], L"/oto") || !_wcsicmp(argv[i], L"/auto")) otomatik = 1;
    if (otomatik) {
        hepsini_calistir(2, 120);
        con(L"\n  Bitti. Çıkmak için bir tuşa basın...");
        tus_oku();
        CloseHandle(g_rep);
        return 0;
    }

    for (;;) {
        int s = menu_sec();
        switch (s) {
        case '1': hepsini_calistir(2, 120); break;
        case '2': sistem_bilgisi(); break;
        case '3': smart_kontrol(); break;
        case '4': disk_testleri(0, 1); break;
        case '5': disk_testleri(1, 1); break;
        case '6': ram_testi(3); break;
        case '7': ram_testi(10); break;
        case '8': cpu_testi(180); break;
        case '9': cpu_testi(900); break;
        case 'W': if (!g_nd) diskleri_bul(); windows_kontrol(); break;
        case 'B': onyukleme_kontrol(); break;
        case 'S': ozet(); break;
        case 'R': {
            flush_rep();
            wchar_t cmd[MAX_PATH + 32];
            swprintf(cmd, MAX_PATH + 32, L"notepad.exe \"%ls\"", g_repPath);
            STARTUPINFOW si; PROCESS_INFORMATION pi;
            ZeroMemory(&si, sizeof(si)); si.cb = sizeof(si);
            if (CreateProcessW(NULL, cmd, NULL, NULL, FALSE, 0, NULL, NULL, &si, &pi)) {
                CloseHandle(pi.hProcess); CloseHandle(pi.hThread);
            } else pr(L"  Not Defteri açılamadı.\n");
            break;
        }
        case '0': case 27:
            pr(L"\n  Rapor kaydedildi: %ls\n", g_repPath);
            CloseHandle(g_rep);
            return 0;
        default: break;
        }
    }
}
