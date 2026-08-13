import AppKit
import Darwin
import Foundation

@main
struct FeatureKanbanBootstrap {
    private static func showFailure(_ message: String) {
        NSApplication.shared.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.alertStyle = .critical
        alert.messageText = "Feature Kanban could not start"
        alert.informativeText = message
        alert.runModal()
    }

    static func main() {
        guard let resources = Bundle.main.resourceURL else {
            showFailure("The application resource directory is unavailable.")
            exit(1)
        }
        let node = Bundle.main.bundleURL.appendingPathComponent(
            "Contents/MacOS/FeatureKanbanNode",
            isDirectory: false
        )
        let launcher = resources.appendingPathComponent(
            "app/server/launcher/index.js",
            isDirectory: false
        )
        let child = Process()
        child.executableURL = node
        child.arguments = [launcher.path] + Array(CommandLine.arguments.dropFirst())
        var environment = ProcessInfo.processInfo.environment
        environment["FEATURE_KANBAN_INSTALL_ROOT"] = resources.path
        child.environment = environment
        let uninstallRequested = CommandLine.arguments.dropFirst().contains("--uninstall")
        do {
            if !uninstallRequested {
                child.standardOutput = FileHandle.nullDevice
                child.standardError = FileHandle.nullDevice
            }
            try child.run()
            if uninstallRequested {
                child.waitUntilExit()
                exit(child.terminationStatus)
            }
        } catch {
            showFailure(error.localizedDescription)
            exit(1)
        }
    }
}
