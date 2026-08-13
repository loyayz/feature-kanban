import { createServer } from "node:net";

export function isLoopbackTcpPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE" || error.code === "EACCES") {
        resolve(false);
        return;
      }
      reject(new Error(`Unable to check loopback TCP port ${port}: ${error.message}`, { cause: error }));
    });
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      server.close((error) => {
        if (error) reject(new Error(`Unable to release loopback TCP port ${port}: ${error.message}`, { cause: error }));
        else resolve(true);
      });
    });
  });
}
