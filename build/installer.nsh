; Crosshair Studio keeps running in the tray after its window is closed, so the installer
; closes it by name before replacing files. Replaces electron-builder's default check, which
; only looks for processes inside the install folder.
!macro customCheckAppRunning
  StrCpy $R1 0
  xhs_kill:
    nsExec::Exec `"$SYSDIR\cmd.exe" /C taskkill /F /T /IM "${APP_EXECUTABLE_FILENAME}"`
    Pop $R0
    Sleep 800
    nsExec::Exec `"$SYSDIR\cmd.exe" /C tasklist /FI "IMAGENAME eq ${APP_EXECUTABLE_FILENAME}" /FO CSV /NH | "$SYSDIR\findstr.exe" /B /I /C:"$\"${APP_EXECUTABLE_FILENAME}$\""`
    Pop $R0
    ${if} $R0 == 0
      IntOp $R1 $R1 + 1
      ${if} $R1 < 3
        Goto xhs_kill
      ${endIf}
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Crosshair Studio is still running (it may have been started as administrator).$\r$\n$\r$\nRight-click the green crosshair icon in the taskbar tray and choose Quit, or end Crosshair Studio in Task Manager (Ctrl+Shift+Esc). Then click Retry." /SD IDCANCEL IDRETRY xhs_kill
      Quit
    ${endIf}
!macroend
