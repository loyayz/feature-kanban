Option Explicit

If WScript.Arguments.Count <> 1 Then
    WScript.Quit 2
End If

Dim shell, installRoot, nodePath, launcherPath, command, exitCode
Set shell = CreateObject("WScript.Shell")
installRoot = WScript.Arguments(0)
nodePath = shell.Environment("Process")("FEATURE_KANBAN_NODE_PATH")
If Len(nodePath) = 0 Then
    nodePath = "node"
End If
launcherPath = installRoot & "\app\server\launcher\index.js"
shell.Environment("Process")("FEATURE_KANBAN_INSTALL_ROOT") = installRoot
command = Chr(34) & nodePath & Chr(34) & " " & Chr(34) & launcherPath & Chr(34)

On Error Resume Next
exitCode = shell.Run(command, 0, True)
If Err.Number <> 0 Then
    shell.Popup "Feature Kanban requires local Node.js 24 or newer. Install Node.js or set FEATURE_KANBAN_NODE_PATH.", 0, "Feature Kanban could not start", 16
    WScript.Quit 1
End If
On Error GoTo 0

WScript.Quit exitCode
