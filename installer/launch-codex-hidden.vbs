Option Explicit

If WScript.Arguments.Count <> 1 Then
    WScript.Quit 2
End If

Dim shell, installRoot, nodePath, launcherPath, command, exitCode
Set shell = CreateObject("WScript.Shell")
installRoot = WScript.Arguments(0)
nodePath = installRoot & "\runtime\node.exe"
launcherPath = installRoot & "\app\server\launcher\index.js"
shell.Environment("Process")("FEATURE_KANBAN_INSTALL_ROOT") = installRoot
command = Chr(34) & nodePath & Chr(34) & " " & Chr(34) & launcherPath & Chr(34)

On Error Resume Next
exitCode = shell.Run(command, 0, True)
If Err.Number <> 0 Then
    WScript.Quit 1
End If
On Error GoTo 0

WScript.Quit exitCode
