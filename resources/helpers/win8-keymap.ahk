#Requires AutoHotkey v2.0
#SingleInstance Force

; Remap Windows key to F24 ONLY when the Win8 simulator Electron window is focused.
; This prevents the OS from intercepting the Win key, allowing the simulator to handle it.
; When any other window is focused, the Windows key works normally.

#HotIf WinActive("Windows ahk_class Chrome_WidgetWin_1")
LWin::F24
RWin::F24

; Forward Win+Arrow through a synthetic modifier chord so Electron can
; observe the shortcut even when focus is inside embedded web content.
#Left::Send "^!+{Left}"
#Right::Send "^!+{Right}"
#Up::Send "^!+{Up}"
#Down::Send "^!+{Down}"
#HotIf
