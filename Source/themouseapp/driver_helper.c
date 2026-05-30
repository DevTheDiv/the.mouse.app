/*
 * driver_helper.c - Interception Driver Manager (compiled to driver_manager.exe)
 * Self-elevates via UAC if needed, then shows an interactive menu.
 *
 * Status is determined by two independent checks:
 *   - interception_create_context(): is the driver running right now?
 *   - keyboard.sys / mouse.sys in system32\drivers: are the files present?
 *
 * Interception uses class filter drivers (loaded per-device by the PnP manager,
 * not just by the SCM), so they cannot be cleanly unloaded from a running system.
 * Uninstall removes registry entries via install-interception.exe, then schedules
 * the locked .sys files for deletion on the next reboot via MoveFileExW.
 */
#define WIN32_LEAN_AND_MEAN
#ifndef _UNICODE
#define _UNICODE
#endif
#ifndef UNICODE
#define UNICODE
#endif
#include <windows.h>
#include <shellapi.h>
#include <stdlib.h>
#include <stdio.h>
#include <conio.h>
#include "Libraries/interception.h"

/* ── elevation ─────────────────────────────────────────────────────────── */

static BOOL IsElevated(void)
{
    BOOL result = FALSE;
    HANDLE token;
    if (OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) {
        TOKEN_ELEVATION elev;
        DWORD cb;
        if (GetTokenInformation(token, TokenElevation, &elev, sizeof(elev), &cb))
            result = (BOOL)elev.TokenIsElevated;
        CloseHandle(token);
    }
    return result;
}

/* ── driver status ──────────────────────────────────────────────────────── */

typedef enum { DRV_INSTALLED, DRV_NOT_INSTALLED, DRV_REBOOT_REQUIRED } DrvStatus;

static BOOL SysFileExists(const wchar_t *filename)
{
    wchar_t path[MAX_PATH];
    GetWindowsDirectoryW(path, MAX_PATH);
    wcscat_s(path, _countof(path), L"\\System32\\drivers\\");
    wcscat_s(path, _countof(path), filename);
    return (GetFileAttributesW(path) != INVALID_FILE_ATTRIBUTES);
}

static DrvStatus GetDriverStatus(void)
{
    BOOL filesPresent = SysFileExists(L"keyboard.sys") || SysFileExists(L"mouse.sys");

    InterceptionContext ctx = interception_create_context();
    BOOL running = (ctx != NULL);
    if (ctx) interception_destroy_context(ctx);

    if (!running && !filesPresent) return DRV_NOT_INSTALLED;
    if  (running && !filesPresent) return DRV_REBOOT_REQUIRED; /* files gone, reboot to finish */
    return DRV_INSTALLED;
}

static const char *StatusLabel(DrvStatus s)
{
    switch (s) {
        case DRV_NOT_INSTALLED:   return "[NOT INSTALLED]";
        case DRV_REBOOT_REQUIRED: return "[REBOOT REQUIRED TO COMPLETE UNINSTALL]";
        default:                  return "[INSTALLED]";
    }
}

/* ── helpers ────────────────────────────────────────────────────────────── */

static int RunTool(const wchar_t *dir, BOOL uninstall)
{
    wchar_t cmd[MAX_PATH + 64];
    _snwprintf_s(cmd, _countof(cmd), _TRUNCATE,
                 L"\"%sinstall-interception.exe\" %s",
                 dir, uninstall ? L"/uninstall" : L"/install");

    STARTUPINFOW si = { sizeof(si) };
    PROCESS_INFORMATION pi;
    DWORD exitCode = 1;
    if (CreateProcessW(NULL, cmd, NULL, NULL, FALSE, 0, NULL, dir, &si, &pi)) {
        WaitForSingleObject(pi.hProcess, INFINITE);
        GetExitCodeProcess(pi.hProcess, &exitCode);
        CloseHandle(pi.hProcess);
        CloseHandle(pi.hThread);
    } else {
        printf("Error: could not launch install-interception.exe (error %lu)\n",
               GetLastError());
    }
    return (int)exitCode;
}

/* Schedule a system32\drivers\<filename> for deletion on next reboot.
 * Returns TRUE if the file is already gone or successfully scheduled. */
static BOOL ScheduleSysForDeletion(const wchar_t *filename)
{
    wchar_t path[MAX_PATH];
    GetWindowsDirectoryW(path, MAX_PATH);
    wcscat_s(path, _countof(path), L"\\System32\\drivers\\");
    wcscat_s(path, _countof(path), filename);

    if (GetFileAttributesW(path) == INVALID_FILE_ATTRIBUTES) return TRUE; /* already gone */
    if (DeleteFileW(path)) return TRUE;                                    /* deleted now  */

    /* File is locked by the running driver — queue it for next-boot deletion */
    if (MoveFileExW(path, NULL, MOVEFILE_DELAY_UNTIL_REBOOT)) {
        printf("  %ls: scheduled for deletion on next reboot.\n", filename);
        return TRUE;
    }
    printf("  %ls: could not schedule for deletion (error %lu).\n",
           filename, GetLastError());
    return FALSE;
}

static void WaitKey(void)
{
    printf("\nPress any key to continue...");
    _getch();
}

/* ── main ───────────────────────────────────────────────────────────────── */

int main(void)
{
    wchar_t self[MAX_PATH];
    GetModuleFileNameW(NULL, self, MAX_PATH);

    if (!IsElevated()) {
        SHELLEXECUTEINFOW sei = { sizeof(sei) };
        sei.lpVerb = L"runas";
        sei.lpFile = self;
        sei.nShow  = SW_NORMAL;
        if (!ShellExecuteExW(&sei)) {
            printf("Elevation failed (error %lu).\n", GetLastError());
            WaitKey();
        }
        return 0;
    }

    wchar_t dir[MAX_PATH];
    wcsncpy_s(dir, _countof(dir), self, _TRUNCATE);
    wchar_t *slash = wcsrchr(dir, L'\\');
    if (slash) *(slash + 1) = L'\0';

    for (;;) {
        system("cls");

        DrvStatus status = GetDriverStatus();

        printf("============================================\n");
        printf("  Interception Driver Manager\n");
        printf("============================================\n\n");
        printf("  Status: %s\n\n", StatusLabel(status));
        printf("  1. Install driver\n");
        printf("  2. Uninstall driver\n");
        printf("  3. Recheck status\n");
        printf("  4. Exit\n");
        printf("\nChoice: ");

        int ch = _getch();
        printf("%c\n\n", ch);

        if (ch == '1') {
            if (status == DRV_INSTALLED) {
                printf("Driver is already installed.\n");
            } else if (status == DRV_REBOOT_REQUIRED) {
                printf("An uninstall is pending. Please reboot first,\n"
                       "then reinstall if needed.\n");
            } else {
                printf("Installing Interception driver...\n\n");
                RunTool(dir, FALSE);
                printf("\n");
                if (GetDriverStatus() == DRV_INSTALLED)
                    printf("Driver installed successfully.\n");
                else
                    printf("Installation failed. Check that Secure Boot is disabled\n"
                           "and that you accepted the UAC prompt.\n");
            }
            WaitKey();

        } else if (ch == '2') {
            if (status == DRV_NOT_INSTALLED) {
                printf("Driver is not currently installed.\n");
                WaitKey();
            } else if (status == DRV_REBOOT_REQUIRED) {
                printf("Uninstall is already pending — please reboot to complete.\n");
                WaitKey();
            } else {
                /* Run install-interception.exe to remove registry entries
                 * (UpperFilters, service keys). It may fail to delete the .sys
                 * files while the class filter is still bound to running devices,
                 * so we schedule those ourselves with MoveFileExW. */
                printf("Removing driver registry entries...\n\n");
                RunTool(dir, TRUE);

                printf("\nScheduling driver files for removal on next reboot...\n");
                ScheduleSysForDeletion(L"keyboard.sys");
                ScheduleSysForDeletion(L"mouse.sys");

                printf("\n");
                DrvStatus after = GetDriverStatus();
                if (after == DRV_NOT_INSTALLED) {
                    printf("Driver uninstalled successfully.\n");
                } else {
                    printf("Driver uninstall queued.\n"
                           "Please reboot — the driver will be fully removed on startup.\n");
                }
                WaitKey();
            }

        } else if (ch == '3') {
            /* just loop to recheck */
        } else if (ch == '4' || ch == 'q' || ch == 'Q' || ch == 27 /* ESC */) {
            break;
        }
    }

    return 0;
}
