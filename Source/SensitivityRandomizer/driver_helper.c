/*
 * driver_helper.c - Interception Driver Manager (compiled to driver_manager.exe)
 * Self-elevates via UAC if needed, then shows an interactive menu.
 * Uses interception_create_context() as the ground-truth driver status check.
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

static BOOL IsDriverInstalled(void)
{
    InterceptionContext ctx = interception_create_context();
    if (ctx) {
        interception_destroy_context(ctx);
        return TRUE;
    }
    return FALSE;
}

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

static void WaitKey(void)
{
    printf("\nPress any key to continue...");
    _getch();
}

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

        BOOL installed = IsDriverInstalled();

        printf("============================================\n");
        printf("  Interception Driver Manager\n");
        printf("============================================\n\n");
        printf("  Status: %s\n\n",
               installed ? "[INSTALLED]" : "[NOT INSTALLED]");
        printf("  1. Install driver\n");
        printf("  2. Uninstall driver\n");
        printf("  3. Recheck status\n");
        printf("  4. Exit\n");
        printf("\nChoice: ");

        int ch = _getch();
        printf("%c\n\n", ch);

        if (ch == '1') {
            if (installed) {
                printf("Driver is already installed.\n");
            } else {
                printf("Installing Interception driver...\n\n");
                RunTool(dir, FALSE);
                printf("\n");
                if (IsDriverInstalled())
                    printf("Driver installed successfully.\n");
                else
                    printf("Installation failed. Check that Secure Boot is disabled\n"
                           "and that you accepted the UAC prompt.\n");
            }
            WaitKey();
        } else if (ch == '2') {
            if (!installed) {
                printf("Driver is not currently installed.\n");
            } else {
                printf("Uninstalling Interception driver...\n\n");
                RunTool(dir, TRUE);
                printf("\n");
                if (!IsDriverInstalled())
                    printf("Driver uninstalled successfully.\n");
                else
                    printf("Uninstallation may have failed.\n");
            }
            WaitKey();
        } else if (ch == '3') {
            /* just loop to recheck */
        } else if (ch == '4' || ch == 'q' || ch == 'Q' || ch == 27 /* ESC */) {
            break;
        }
    }

    return 0;
}
