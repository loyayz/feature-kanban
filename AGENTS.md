# Project Agent Instructions

## Node.js commands on Windows

- This project uses nvm-windows from `C:\programs\nvm`; `package.json` requires Node.js 24 or newer.
- Before running Node.js package commands, check `nvm current` and `nvm list`. If the active version does not satisfy the project requirement, activate an installed Node.js 24 release with `nvm use <version>`.
- Do not assume the sandbox `PATH` exposes the nvm-managed `npm` or `npx`. Codex may inject its own `node.exe` while omitting those shims. Resolve `npm.cmd` or `npx.cmd` through the nvm-managed Node.js installation (normally the symlink configured by `C:\programs\nvm\settings.txt`) and invoke the `.cmd` file explicitly from PowerShell.
- Treat a missing `npm`/`npx` command as a PATH-resolution problem first, not as evidence that npm is uninstalled. Never continue with stale compiled output after a package or TypeScript command fails.
