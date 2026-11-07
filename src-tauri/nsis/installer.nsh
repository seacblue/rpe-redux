; Owns the NSIS uninstall hook for deployment data that lives beside the executable.

!macro NSIS_HOOK_POSTUNINSTALL
  ; Match Tauri's delete-data checkbox and keep update handoffs non-destructive.
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    RmDir /r "$INSTDIR\user-data"
    RmDir /r "$INSTDIR\webview-data"
  ${EndIf}
!macroend
