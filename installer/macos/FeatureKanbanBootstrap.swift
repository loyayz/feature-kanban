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

    private static func validateNode(_ environment: [String: String]) -> String? {
        let probe = Process()
        if let configuredNode = environment["FEATURE_KANBAN_NODE_PATH"], !configuredNode.isEmpty {
            probe.executableURL = URL(fileURLWithPath: configuredNode)
            probe.arguments = ["--version"]
        } else {
            probe.executableURL = URL(fileURLWithPath: "/usr/bin/env")
            probe.arguments = ["node", "--version"]
        }
        let output = Pipe()
        probe.standardOutput = output
        probe.standardError = FileHandle.nullDevice
        probe.environment = environment
        do {
            try probe.run()
            probe.waitUntilExit()
        } catch {
            return "Feature Kanban requires local Node.js 24 or newer. Install Node.js or set FEATURE_KANBAN_NODE_PATH."
        }
        let data = output.fileHandleForReading.readDataToEndOfFile()
        let version = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let majorText = version.dropFirst(version.hasPrefix("v") ? 1 : 0).split(separator: ".").first
        guard probe.terminationStatus == 0, let majorText, let major = Int(majorText), major >= 24 else {
            return "Feature Kanban requires local Node.js 24 or newer; found \(version.isEmpty ? "an unavailable runtime" : version)."
        }
        return nil
    }

    static func main() {
        guard let resources = Bundle.main.resourceURL else {
            showFailure("The application resource directory is unavailable.")
            exit(1)
        }
        let launcher = resources.appendingPathComponent(
            "app/server/launcher/index.js",
            isDirectory: false
        )
        let child = Process()
        var environment = ProcessInfo.processInfo.environment
        if let failure = validateNode(environment) {
            showFailure(failure)
            exit(1)
        }
        if let configuredNode = environment["FEATURE_KANBAN_NODE_PATH"], !configuredNode.isEmpty {
            child.executableURL = URL(fileURLWithPath: configuredNode)
            child.arguments = [launcher.path] + Array(CommandLine.arguments.dropFirst())
        } else {
            child.executableURL = URL(fileURLWithPath: "/usr/bin/env")
            child.arguments = ["node", launcher.path] + Array(CommandLine.arguments.dropFirst())
        }
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
