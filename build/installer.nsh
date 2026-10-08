; Crosshair Studio installer customizations (included by electron-builder's NSIS template).

; Sets _RETURN to 0 when a "Crosshair Studio.exe" process is running.
; The search string is \"…\"-escaped for findstr, so it anchors on the exact image name and
; never matches "Uninstall Crosshair Studio.exe".
!macro xhsIsRunning _RETURN
  nsExec::Exec `"$SYSDIR\cmd.exe" /C tasklist /FI "IMAGENAME eq ${APP_EXECUTABLE_FILENAME}" /FO CSV /NH | "$SYSDIR\findstr.exe" /B /I /C:"\"${APP_EXECUTABLE_FILENAME}\""`
  Pop ${_RETURN}
!macroend

; The app keeps running in the tray after its window is closed, so close it by name, then wait
; until it has really exited (and released its files) before anything is replaced.
!macro customCheckAppRunning
  StrCpy $R1 0
  xhs_kill:
    nsExec::Exec `"$SYSDIR\cmd.exe" /C taskkill /F /T /IM "${APP_EXECUTABLE_FILENAME}"`
    Pop $R0
    StrCpy $R2 0
    xhs_wait:
      Sleep 500
      !insertmacro xhsIsRunning $R0
      ${if} $R0 == 0
        IntOp $R2 $R2 + 1
        ${if} $R2 < 10
          Goto xhs_wait
        ${endIf}
      ${endIf}
    ${if} $R0 == 0
      IntOp $R1 $R1 + 1
      ${if} $R1 < 3
        Goto xhs_kill
      ${endIf}
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Crosshair Studio is still running (it may have been started as administrator).$\r$\n$\r$\nRight-click the green crosshair icon in the taskbar tray and choose Quit, or end Crosshair Studio in Task Manager (Ctrl+Shift+Esc). Then click Retry." /SD IDCANCEL IDRETRY xhs_kill
      Quit
    ${endIf}
  ; Give Windows a moment to release file handles after the process exits.
  Sleep 500
!macroend

; Uninstall step: remove what can be removed and never abort on a busy file. During an update
; the new version's files are written straight over anything left behind.
!macro customRemoveFiles
  SetOutPath $TEMP
  RMDir /r $INSTDIR
  ClearErrors
!macroend

; Updating: if the previous version's uninstaller still reports a failure, install over it
; instead of stopping with "Failed to uninstall old application files".
!macro customUnInstallCheck
  ${if} $R0 != 0
    DetailPrint `Previous version's uninstaller returned $R0; installing over it.`
  ${endif}
  ClearErrors
!macroend

!macro customUnInstallCheckCurrentUser
  !insertmacro customUnInstallCheck
!macroend
