const fs = require("fs");
const path = require("path");
const cron = require("node-cron");
const { v4: uuidv4 } = require("uuid");
const { getEnv } = require("./config/env");
const { OrderStore, ORDER_STATUS } = require("./models/order");
const { AWSProvisioning } = require("./services/awsProvisioning");
const { EmailService } = require("./services/emailService");

const env = getEnv();

class Scheduler {
  constructor() {
    this.dataDir = env.dataDir;
    this.jobsFile = path.join(this.dataDir, "jobs.json");
    this.orderStore = new OrderStore();
    this.awsProvisioning = new AWSProvisioning();
    this.emailService = new EmailService();
    this.ensureJobsFile();
    this.task = null;
  }

  ensureJobsFile() {
    if (!fs.existsSync(this.jobsFile)) {
      fs.writeFileSync(this.jobsFile, JSON.stringify([], null, 2));
    }
  }

  readJobs() {
    try {
      const data = fs.readFileSync(this.jobsFile, "utf-8");
      return JSON.parse(data);
    } catch (err) {
      return [];
    }
  }

  writeJobs(jobs) {
    fs.writeFileSync(this.jobsFile, JSON.stringify(jobs, null, 2));
  }

  createProvisionJob(orderId, deliveryTime) {
    const jobs = this.readJobs();
    const job = {
      id: uuidv4(),
      orderId,
      type: "provision",
      scheduledTime: new Date(deliveryTime).toISOString(),
      createdAt: new Date().toISOString(),
      status: "pending",
      result: null,
    };
    jobs.push(job);
    this.writeJobs(jobs);
    return job;
  }

  createCleanupJob(orderId, afterJobId, delayHours) {
    const jobs = this.readJobs();

    const existing = jobs.find(
      (j) =>
        (j.type === "cleanup" || j.type === "verify") &&
        j.orderId === orderId &&
        j.afterJobId === afterJobId &&
        (j.status === "pending" || j.status === "completed")
    );
    if (existing) {
      if (existing.type === "verify") {
        return this.updateJob(existing.id, {
          type: "cleanup",
          delayHours:
            existing.delayHours === undefined || existing.delayHours === null
              ? delayHours
              : existing.delayHours,
        });
      }
      return existing;
    }

    const job = {
      id: uuidv4(),
      orderId,
      type: "cleanup",
      afterJobId,
      delayHours,
      scheduledTime: null,
      createdAt: new Date().toISOString(),
      status: "pending",
      result: null,
    };
    jobs.push(job);
    this.writeJobs(jobs);
    return job;
  }

  updateJob(jobId, updates) {
    const jobs = this.readJobs();
    const idx = jobs.findIndex((j) => j.id === jobId);
    if (idx === -1) {
      throw new Error(`Job ${jobId} not found`);
    }
    jobs[idx] = { ...jobs[idx], ...updates };
    this.writeJobs(jobs);
    return jobs[idx];
  }

  migrateLegacyVerifyJob(job) {
    if (job.type !== "verify") {
      return job;
    }

    const updates = {
      type: "cleanup",
    };

    if (job.delayHours === undefined || job.delayHours === null) {
      const order = this.orderStore.findById(job.orderId);
      updates.delayHours = Number(order?.quantity || 0);
    }

    return this.updateJob(job.id, updates);
  }

  async executeProvisionJob(job) {
    try {
      const order = this.orderStore.findById(job.orderId);
      if (!order) {
        throw new Error(`Order ${job.orderId} not found`);
      }

      this.orderStore.update(job.orderId, {
        status: ORDER_STATUS.PROVISIONING_STARTED,
      });

      const instanceResult = await this.awsProvisioning.provisionInstance(job.orderId);
      const instanceIp = instanceResult.publicIp || "203.0.113.42";

      const dnsResult = await this.awsProvisioning.createDnsRecord(job.orderId, instanceIp);
      const provisionedAt = new Date().toISOString();
      const delayHours = Number(order.quantity);
      const cleanupJob = this.createCleanupJob(job.orderId, job.id, delayHours);
      const cleanupScheduledTime = new Date(
        new Date(provisionedAt).getTime() + delayHours * 60 * 60 * 1000
      ).toISOString();

      this.orderStore.update(job.orderId, {
        status: ORDER_STATUS.PROVISIONED,
        ec2InstanceId: instanceResult.instanceId,
        dnsRecordId: dnsResult.recordId,
        dnsRecordName: dnsResult.name,
        dnsRecordValue: instanceIp,
        provisionedAt,
        cleanupJobId: cleanupJob.id,
        cleanupScheduledTime,
      });

      this.updateJob(job.id, {
        status: "completed",
        completedAt: provisionedAt,
        result: {
          instanceId: instanceResult.instanceId,
          dnsName: dnsResult.name,
        },
      });

      this.updateJob(cleanupJob.id, {
        scheduledTime: cleanupScheduledTime,
      });

      await this.emailService.sendProvisionSuccessEmail(order, dnsResult.name).catch((err) => {
        console.error(`Email send failed for order ${job.orderId}:`, err.message);
      });

      console.log(`Provision job ${job.id} completed for order ${job.orderId}`);
    } catch (err) {
      console.error(`Provision job ${job.id} failed:`, err.message);
      this.orderStore.update(job.orderId, {
        status: ORDER_STATUS.FAILED,
      });
      this.updateJob(job.id, {
        status: "failed",
        completedAt: new Date().toISOString(),
        result: { error: err.message },
      });
    }
  }

  async executeCleanupJob(job) {
    try {
      const order = this.orderStore.findById(job.orderId);
      if (!order) {
        throw new Error(`Order ${job.orderId} not found`);
      }

      const cleanupResult = await this.awsProvisioning.cleanupResources(
        job.orderId,
        order.ec2InstanceId,
        order.dnsRecordName,
        order.dnsRecordValue
      );

      this.orderStore.update(job.orderId, {
        status: ORDER_STATUS.COMPLETE,
        cleanedUpAt: new Date().toISOString(),
      });

      this.updateJob(job.id, {
        status: "completed",
        completedAt: new Date().toISOString(),
        result: cleanupResult,
      });

      console.log(`Cleanup job ${job.id} completed for order ${job.orderId}`);
    } catch (err) {
      console.error(`Cleanup job ${job.id} failed:`, err.message);
      this.orderStore.update(job.orderId, {
        status: ORDER_STATUS.FAILED,
      });
      this.updateJob(job.id, {
        status: "failed",
        completedAt: new Date().toISOString(),
        result: { error: err.message },
      });
    }
  }

  async processPendingJobs() {
    const jobs = this.readJobs();
    const now = new Date();

    for (const pendingJob of jobs) {
      const job = this.migrateLegacyVerifyJob(pendingJob);

      if (job.status !== "pending") continue;

      if (job.type === "provision") {
        const scheduledTime = new Date(job.scheduledTime);
        if (scheduledTime <= now) {
          await this.executeProvisionJob(job);
        }
      } else if (job.type === "cleanup") {
        const afterJob = jobs.find((j) => j.id === job.afterJobId);
        if (!afterJob || afterJob.status !== "completed") continue;

        let scheduledTimeIso = job.scheduledTime;

        if (!scheduledTimeIso) {
          const base = afterJob.completedAt
            ? new Date(afterJob.completedAt)
            : new Date();
          const delayHours = Number(job.delayHours || 0);
          scheduledTimeIso = new Date(
            base.getTime() + delayHours * 60 * 60 * 1000
          ).toISOString();
          this.updateJob(job.id, { scheduledTime: scheduledTimeIso });

          const order = this.orderStore.findById(job.orderId);
          if (order) {
            this.orderStore.update(job.orderId, {
              cleanupScheduledTime: scheduledTimeIso,
            });
          }
        }

        const scheduledTime = new Date(scheduledTimeIso);
        if (!Number.isNaN(scheduledTime.getTime()) && scheduledTime <= now) {
          await this.executeCleanupJob(job);
        }
      }
    }
  }

  start() {
    console.log(`Starting scheduler with cron: ${env.schedulerCron}`);
    this.task = cron.schedule(env.schedulerCron, async () => {
      try {
        await this.processPendingJobs();
      } catch (err) {
        console.error("Scheduler error:", err.message);
      }
    });
  }

  stop() {
    if (this.task) {
      this.task.stop();
      console.log("Scheduler stopped");
    }
  }
}

module.exports = {
  Scheduler,
};
