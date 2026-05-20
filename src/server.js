import app from "./app.js";
import { connectDatabase } from "./config/db.js";
import { env } from "./config/env.js";

const startServer = async () => { 
  await connectDatabase();

  const server = app.listen(env.port, () => {
    console.log(`Cantley API running on port ${env.port} in ${env.nodeEnv} mode`);
  });

  const shutdown = (signal) => {
    console.log(`${signal} received. Shutting down gracefully.`);
    server.close(() => {
      process.exit(0);
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
};

startServer();
