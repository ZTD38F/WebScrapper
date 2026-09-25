import fs from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import { config } from "./config.js";
import {
  enqueueJob,
  getJob,
  listJobs,
  cancelJob,
  createSchedule,
  getSchedule,
  listSchedules,
  deleteSchedule,
  setScheduleEnabled,
  closeDatabase
} from "./db.js";
import { listProfiles, resetProfile } from "./browser.js";
import { startRuntimeWorkers } from "./worker.js";

const app = Fastify({
  logger: true,
  bodyLimit: 10 * 1024 * 1024
});

function authorized(request) {
  if (!config.token) return true;
  const header = String(request.headers.authorization || "");
  return header === "Bearer " + config.token;
}

app.addHook("onRequest", async (request, reply) => {
  if (request.url === "/health") return;
  if (!authorized(request)) {
    return reply.code(401).send({ error: "Unauthorized" });
  }
});

app.get("/health", async () => ({
  ok: true,
  service: "webscrapper-server",
  version: "0.1.0",
  workers: config.workers,
  headless: config.headless,
  authRequired: Boolean(config.token)
}));

app.post("/v1/jobs", async (request, reply) => {
  const body = request.body || {};
  const type = String(body.type || "scrape");
  if (type !== "scrape") return reply.code(400).send({ error: "Only scrape jobs are supported" });
  if (!body.payload || typeof body.payload !== "object") {
    return reply.code(400).send({ error: "payload object is required" });
  }

  try {
    const job = enqueueJob({
      type,
      payload: body.payload,
      runAt: body.runAt,
      maxAttempts: body.maxAttempts
    });
    return reply.code(202).send(job);
  } catch (error) {
    return reply.code(400).send({ error: error.message });
  }
});

app.post("/v1/scrape", async (request, reply) => {
  try {
    const job = enqueueJob({
      type: "scrape",
      payload: request.body || {},
      maxAttempts: Number(request.body?.maxAttempts) || 3
    });
    return reply.code(202).send(job);
  } catch (error) {
    return reply.code(400).send({ error: error.message });
  }
});

app.get("/v1/jobs", async (request) => {
  const limit = Number(request.query?.limit) || 100;
  const status = request.query?.status ? String(request.query.status) : undefined;
  return { jobs: listJobs({ limit, status }) };
});

app.get("/v1/jobs/:id", async (request, reply) => {
  const job = getJob(String(request.params.id));
  if (!job) return reply.code(404).send({ error: "Job not found" });
  return job;
});

app.post("/v1/jobs/:id/cancel", async (request, reply) => {
  const id = String(request.params.id);
  const changed = cancelJob(id);
  if (!changed && !getJob(id)) return reply.code(404).send({ error: "Job not found" });
  return getJob(id);
});

app.get("/v1/schedules", async () => ({ schedules: listSchedules() }));

app.post("/v1/schedules", async (request, reply) => {
  const body = request.body || {};
  if (!body.payload || typeof body.payload !== "object") {
    return reply.code(400).send({ error: "payload object is required" });
  }
  try {
    const schedule = createSchedule({
      name: body.name,
      intervalSeconds: body.intervalSeconds,
      payload: body.payload,
      enabled: body.enabled !== false,
      nextRunAt: body.nextRunAt
    });
    return reply.code(201).send(schedule);
  } catch (error) {
    return reply.code(400).send({ error: error.message });
  }
});

app.get("/v1/schedules/:id", async (request, reply) => {
  const schedule = getSchedule(String(request.params.id));
  if (!schedule) return reply.code(404).send({ error: "Schedule not found" });
  return schedule;
});

app.post("/v1/schedules/:id/enabled", async (request, reply) => {
  const id = String(request.params.id);
  const changed = setScheduleEnabled(id, Boolean(request.body?.enabled));
  if (!changed) return reply.code(404).send({ error: "Schedule not found" });
  return getSchedule(id);
});

app.delete("/v1/schedules/:id", async (request, reply) => {
  const changed = deleteSchedule(String(request.params.id));
  if (!changed) return reply.code(404).send({ error: "Schedule not found" });
  return { ok: true };
});

app.get("/v1/profiles", async () => ({ profiles: listProfiles() }));

app.delete("/v1/profiles/:id", async (request, reply) => {
  try {
    resetProfile(String(request.params.id));
    return { ok: true };
  } catch (error) {
    return reply.code(409).send({ error: error.message });
  }
});

app.get("/v1/artifacts/:jobId/:name", async (request, reply) => {
  const jobId = String(request.params.jobId);
  const name = String(request.params.name);
  if (!/^[a-zA-Z0-9._-]+$/.test(jobId) || !/^[a-zA-Z0-9._-]+$/.test(name)) {
    return reply.code(400).send({ error: "Invalid artifact path" });
  }

  const filePath = path.join(config.artifactsDir, jobId, name);
  const relative = path.relative(config.artifactsDir, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return reply.code(400).send({ error: "Invalid artifact path" });
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return reply.code(404).send({ error: "Artifact not found" });
  }

  reply.type(name.endsWith(".jpg") || name.endsWith(".jpeg") ? "image/jpeg" : "application/octet-stream");
  return reply.send(fs.createReadStream(filePath));
});

const runtime = startRuntimeWorkers();

async function shutdown(signal) {
  app.log.info({ signal }, "shutting down");
  runtime.stop();
  await app.close().catch(() => {});
  await runtime.stopped().catch(() => {});
  closeDatabase();
  process.exit(0);
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  runtime.stop();
  await runtime.stopped().catch(() => {});
  closeDatabase();
  process.exit(1);
}
