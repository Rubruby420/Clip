; Clip installer — custom shortcuts selection page.
; Hooked in via electron-builder nsis.include.
;
; Flow:  Welcome → License → Scope → Directory → [THIS PAGE] → Installing → Finish
;
; customPageAfterChangeDir is called by assistedInstaller.nsh after the
; directory picker and before MUI_PAGE_INSTFILES.

!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"

!ifndef BUILD_UNINSTALLER

; ── Variables (installer pass only) ───────────────────────────────────────────
Var ShortcutsDialog
Var DesktopCheck
Var StartMenuCheck
Var WantDesktop
Var WantStartMenu

; ── Page functions ─────────────────────────────────────────────────────────────

Function ClipShortcutsPage
  nsDialogs::Create 1018
  Pop $ShortcutsDialog
  ${If} $ShortcutsDialog == error
    Abort
  ${EndIf}

  !insertmacro MUI_HEADER_TEXT "Choose Shortcuts" \
    "Select which shortcuts Setup should create."

  ${NSD_CreateGroupBox} 0 8u 100% 56u "Create shortcuts for Clip"
  Pop $0

  ${NSD_CreateCheckbox} 14u 26u 90% 14u "Create a Desktop shortcut"
  Pop $DesktopCheck
  ${NSD_SetState} $DesktopCheck ${BST_CHECKED}

  ${NSD_CreateCheckbox} 14u 46u 90% 14u "Create a Start Menu shortcut"
  Pop $StartMenuCheck
  ${NSD_SetState} $StartMenuCheck ${BST_CHECKED}

  nsDialogs::Show
FunctionEnd

Function ClipShortcutsPageLeave
  ${NSD_GetState} $DesktopCheck   $WantDesktop
  ${NSD_GetState} $StartMenuCheck $WantStartMenu
FunctionEnd

; ── Inject the page after directory selection, before installation ─────────────

!macro customPageAfterChangeDir
  Page custom ClipShortcutsPage ClipShortcutsPageLeave
!macroend

; ── Create shortcuts after files are extracted ─────────────────────────────────

!macro customInstall
  ${If} $WantDesktop == ${BST_CHECKED}
    CreateShortcut "$DESKTOP\Clip.lnk" "$INSTDIR\Clip.exe"
  ${EndIf}
  ${If} $WantStartMenu == ${BST_CHECKED}
    CreateDirectory "$SMPROGRAMS\Clip"
    CreateShortcut "$SMPROGRAMS\Clip\Clip.lnk" "$INSTDIR\Clip.exe"
  ${EndIf}
!macroend

!endif ; BUILD_UNINSTALLER

; ── Remove shortcuts on uninstall ─────────────────────────────────────────────

!macro customUnInstall
  Delete "$DESKTOP\Clip.lnk"
  Delete "$SMPROGRAMS\Clip\Clip.lnk"
  RMDir  "$SMPROGRAMS\Clip"
!macroend
