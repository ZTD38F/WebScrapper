import {
  claimJob,
  renewLease,
  completeJob,
  failJob,
  isJobCancelled,
  enqueueDueSchedules
} from "./db.js";
import { config } from "./config.js";
import { executeScrapeJob } from "./scrape.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function processJob(job, workerId) {
  let lastHeartbeat = 0;
  const heartbeat = async () => {
    const now = Date.now();
    if (now - lastHeartbeat < Math.max(5000, (config.leaseSeconds * 1000) / 3)) return;
    renewLease(job.id, workerId, config.leaseSeconds);
    lastHeartbeat = now;
  };

  try {
    if (job.type !== "scrape") throw new Error("Unsupported job type: " + job.type);

    const result = await executeScrapeJob({
      jobId: job.id,
      payload: job.payload,
      heartbeat,
      isCancelled: async () => isJobCancelled(job.id)
    });

    if (!isJobCancelled(job.id)) {
      completeJob(job.id, workerId, result);
    }
  } catch (error) {
    if (String(error?.message || error) === "JOB_CANCELLED") return;
    failJob(job.id, workerId, error);
  }
}

async function workerLoop(index, signal) {
  const workerId = process.pid + ":" + index + ":" + crypto.randomUUID();
  while (!signal.aborted) {
    const job = claimJob(workerId, config.leaseSeconds);
    if (!job) {
      await sleep(config.pollMs);
      continue;
    }
    await processJob(job, workerId);
  }
}

async function schedulerLoop(signal) {
  while (!signal.aborted) {
    try {
      enqueueDueSchedules();
    } catch (error) {
      console.error("[scheduler]", error);
    }
    await sleep(Math.max(500, config.pollMs));
  }
}

export function startRuntimeWorkers() {
  const controller = new AbortController();
  const tasks = [
    schedulerLoop(controller.signal),
    ...Array.from({ length: config.workers }, (_, i) => workerLoop(i + 1, controller.signal))
  ];

  return {
    stop() {
      controller.abort();
    },
    async stopped() {
      await Promise.allSettled(tasks);
    }
  };
}
