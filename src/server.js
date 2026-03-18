const { createApp } = require("./app");
const { getEnv } = require("./config/env");
const { Scheduler } = require("./scheduler");

const env = getEnv();
const app = createApp();
const scheduler = new Scheduler();

const server = app.listen(env.port, () => {
  console.log(`Server running on http://localhost:${env.port}`);
  scheduler.start();
});

process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully");
  scheduler.stop();
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("SIGINT received, shutting down gracefully");
  scheduler.stop();
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});
