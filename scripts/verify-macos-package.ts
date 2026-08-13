import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { macDmgFileName, verifyMacAppBundle } from "../src/installer/macos-package.js";

export async function verifyMacPackageCli(args: string[]): Promise<string> {
  const bundleArgument = args[0];
  if (!bundleArgument || bundleArgument.startsWith("--")) throw new Error("A Feature Kanban.app path is required");
  const verified = await verifyMacAppBundle(resolve(bundleArgument));
  const artifactOption = args.indexOf("--artifact-name");
  if (artifactOption >= 0) {
    const mode = args[artifactOption + 1];
    if (mode !== "signed" && mode !== "unsigned") throw new Error("--artifact-name requires signed or unsigned");
    return macDmgFileName(
      verified.manifest.productVersion,
      verified.manifest.architecture,
      mode === "signed",
    );
  }
  return `Verified ${verified.fileCount} macOS package files for ${verified.manifest.architecture} with Node ${verified.manifest.nodeVersion}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyMacPackageCli(process.argv.slice(2))
    .then((message) => console.log(message))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
