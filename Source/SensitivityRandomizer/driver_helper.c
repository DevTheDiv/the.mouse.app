/*
 * driver_helper.c
 * Compiled into driver_install.exe AND driver_uninstall.exe (identical binary, copied twice).
 * Reads its own filename to decide which action to take, then self-elevates via UAC if needed.
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

int main(void)
{
    wchar_t self[MAX_PATH];
    GetModuleFileNameW(NULL, self, MAX_PATH);

    /* Check own filename for "uninstall" */
    BOOL uninstall = (wcsstr(self, L"uninstall") != NULL ||
                      wcsstr(self, L"Uninstall") != NULL);

    /* Re-launch elevated via UAC if not already admin */
    if (!IsElevated()) {
        SHELLEXECUTEINFOW sei = { sizeof(sei) };
        sei.lpVerb = L"runas";
        sei.lpFile = self;
        sei.nShow  = SW_NORMAL;
        if (!ShellExecuteExW(&sei)) {
            printf("Elevation request failed (error %lu).\n", GetLastError());
            system("pause");
        }
        return 0;
    }

    /* Build path to install-interception.exe sitting next to this exe */
    wchar_t dir[MAX_PATH];
    wcsncpy_s(dir, _countof(dir), self, _TRUNCATE);
    wchar_t *slash = wcsrchr(dir, L'\\');
    if (slash) *(slash + 1) = L'\0';

    wchar_t cmd[MAX_PATH + 64];
    _snwprintf_s(cmd, _countof(cmd), _TRUNCATE,
                 L"\"%sinstall-interception.exe\" %s",
                 dir, uninstall ? L"/uninstall" : L"/install");

    printf("%s\n\n", uninstall ? "Uninstalling Interception driver..."
                               : "Installing Interception driver...");

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

    printf("\n");
    system("pause");
    return (int)exitCode;
}
