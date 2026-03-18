const test = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const request = require("supertest");
const { createApp } = require("../src/app");
const { OrderStore, ORDER_STATUS } = require("../src/models/order");
const { Scheduler } = require("../src/scheduler");
const fs = require("fs");
const path = require("path");

let counter = 0;

function setupTest() {
  const dir = path.join(__dirname, "..", `data-test-${counter++}`);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  process.env.DATA_DIR = dir;
  return dir;
}

function cleanup(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true });
}

test("API - Create Order", async () => {
  const dir = setupTest();
  const app = createApp();
  const res = await request(app).post("/api/orders").send({
    quantity: 1,
    deliveryTime: "2026-03-12T15:30:00Z",
    phone: "13800138000",
  });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.body.status, ORDER_STATUS.CREATED);
  cleanup(dir);
});

test("API - Get Order", async () => {
  const dir = setupTest();
  const app = createApp();
  const createRes = await request(app).post("/api/orders").send({
    quantity: 1,
    deliveryTime: "2026-03-12T15:30:00Z",
    phone: "13800138000",
  });
  const getRes = await request(app).get(`/api/orders/${createRes.body.id}`);
  assert.strictEqual(getRes.status, 200);
  assert.strictEqual(getRes.body.id, createRes.body.id);
  cleanup(dir);
});

test("API - Create Payment Session", async () => {
  const dir = setupTest();
  const app = createApp();
  const createRes = await request(app).post("/api/orders").send({
    quantity: 1,
    deliveryTime: "2026-03-12T15:30:00Z",
    phone: "13800138000",
  });
  const paymentRes = await request(app)
    .post(`/api/orders/${createRes.body.id}/payment-session`)
    .send({});
  assert.strictEqual(paymentRes.status, 200);
  assert.ok(paymentRes.body.paymentSessionId);
  cleanup(dir);
});

test("API - Retry Payment Session Reuses Existing Session", async () => {
  const dir = setupTest();
  const app = createApp();
  const createRes = await request(app).post("/api/orders").send({
    quantity: 2,
    deliveryTime: "2026-03-12T15:30:00Z",
    phone: "13800138000",
  });

  const firstRes = await request(app)
    .post(`/api/orders/${createRes.body.id}/payment-session`)
    .send({});

  const retryRes = await request(app)
    .post(`/api/orders/${createRes.body.id}/payment-session`)
    .send({});

  assert.strictEqual(firstRes.status, 200);
  assert.strictEqual(retryRes.status, 200);
  assert.strictEqual(firstRes.body.paymentSessionId, retryRes.body.paymentSessionId);
  assert.strictEqual(firstRes.body.checkoutUrl, retryRes.body.checkoutUrl);
  assert.strictEqual(retryRes.body.reused, true);
  assert.strictEqual(retryRes.body.fromCache, true);

  const orderStore = new OrderStore();
  const storedOrder = orderStore.findById(createRes.body.id);
  assert.strictEqual(storedOrder.status, ORDER_STATUS.PAYMENT_PENDING);
  assert.strictEqual(storedOrder.paymentSessionId, firstRes.body.paymentSessionId);

  cleanup(dir);
});

test("API - Retry Payment Session Does Not Create Provision Jobs", async () => {
  const dir = setupTest();
  const app = createApp();
  const createRes = await request(app).post("/api/orders").send({
    quantity: 1,
    deliveryTime: "2026-03-12T15:30:00Z",
    phone: "13800138000",
  });

  await request(app)
    .post(`/api/orders/${createRes.body.id}/payment-session`)
    .send({});
  await request(app)
    .post(`/api/orders/${createRes.body.id}/payment-session`)
    .send({});

  const scheduler = new Scheduler();
  const jobs = scheduler.readJobs().filter((job) => job.orderId === createRes.body.id);
  assert.strictEqual(jobs.length, 0);

  cleanup(dir);
});

test("API - Mark Payment Success", async () => {
  const dir = setupTest();
  const app = createApp();
  const createRes = await request(app).post("/api/orders").send({
    quantity: 1,
    deliveryTime: "2026-03-12T15:30:00Z",
    phone: "13800138000",
  });
  await request(app)
    .post(`/api/orders/${createRes.body.id}/payment-session`)
    .send({});
  const successRes = await request(app)
    .post(`/api/orders/${createRes.body.id}/payment-success`)
    .send({});
  assert.strictEqual(successRes.status, 200);
  assert.strictEqual(
    successRes.body.status,
    ORDER_STATUS.PROVISIONING_SCHEDULED
  );
  assert.ok(successRes.body.provisionJobId);
  assert.ok(successRes.body.cleanupJobId);
  cleanup(dir);
});

test("Scheduler - Create Provision Job", async () => {
  const dir = setupTest();
  const scheduler = new Scheduler();
  const job = scheduler.createProvisionJob("order-123", new Date().toISOString());
  assert.ok(job.id);
  assert.strictEqual(job.type, "provision");
  assert.strictEqual(job.status, "pending");
  cleanup(dir);
});

test("Scheduler - Create Cleanup Job", async () => {
  const dir = setupTest();
  const scheduler = new Scheduler();
  const job = scheduler.createCleanupJob("order-123", "provision-job-123", 2);
  assert.ok(job.id);
  assert.strictEqual(job.type, "cleanup");
  assert.strictEqual(job.status, "pending");
  assert.strictEqual(job.afterJobId, "provision-job-123");
  assert.strictEqual(job.delayHours, 2);
  cleanup(dir);
});

test("Scheduler - Migrate legacy verify job in createCleanupJob", async () => {
  const dir = setupTest();
  const scheduler = new Scheduler();

  scheduler.writeJobs([
    {
      id: "legacy-verify-1",
      orderId: "order-legacy-1",
      type: "verify",
      afterJobId: "provision-legacy-1",
      delayHours: null,
      scheduledTime: null,
      createdAt: new Date().toISOString(),
      status: "pending",
      result: null,
    },
  ]);

  const migrated = scheduler.createCleanupJob(
    "order-legacy-1",
    "provision-legacy-1",
    3
  );

  assert.strictEqual(migrated.id, "legacy-verify-1");
  assert.strictEqual(migrated.type, "cleanup");
  assert.strictEqual(migrated.delayHours, 3);

  const stored = scheduler.readJobs().find((job) => job.id === "legacy-verify-1");
  assert.strictEqual(stored.type, "cleanup");
  assert.strictEqual(stored.delayHours, 3);

  cleanup(dir);
});

test("Scheduler - Migrate pending legacy verify jobs during processing", async () => {
  const dir = setupTest();
  const scheduler = new Scheduler();
  const orderStore = new OrderStore();
  const order = orderStore.create({
    quantity: 2,
    deliveryTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    phone: "13800138000",
  });

  scheduler.writeJobs([
    {
      id: "provision-legacy-2",
      orderId: order.id,
      type: "provision",
      scheduledTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      createdAt: new Date().toISOString(),
      status: "pending",
      result: null,
    },
    {
      id: "legacy-verify-2",
      orderId: order.id,
      type: "verify",
      afterJobId: "provision-legacy-2",
      scheduledTime: null,
      createdAt: new Date().toISOString(),
      status: "pending",
      result: null,
    },
  ]);

  await scheduler.processPendingJobs();

  const migrated = scheduler.readJobs().find((job) => job.id === "legacy-verify-2");
  assert.strictEqual(migrated.type, "cleanup");
  assert.strictEqual(migrated.delayHours, 2);
  assert.strictEqual(migrated.status, "pending");

  cleanup(dir);
});

test("Scheduler - Execute Provision Job", async () => {
  const dir = setupTest();
  const scheduler = new Scheduler();
  const orderStore = new OrderStore();
  const order = orderStore.create({
    quantity: 1,
    deliveryTime: new Date().toISOString(),
    phone: "13800138000",
  });
  orderStore.update(order.id, { status: ORDER_STATUS.PAYMENT_PENDING });
  orderStore.update(order.id, { status: ORDER_STATUS.PROVISIONING_SCHEDULED });
  const job = scheduler.createProvisionJob(order.id, order.deliveryTime);
  await scheduler.executeProvisionJob(job);
  const updated = orderStore.findById(order.id);
  assert.strictEqual(updated.status, ORDER_STATUS.PROVISIONED);
  assert.ok(updated.cleanupJobId);
  assert.ok(updated.cleanupScheduledTime);

  const cleanupJob = scheduler
    .readJobs()
    .find((j) => j.type === "cleanup" && j.afterJobId === job.id);
  assert.ok(cleanupJob);
  assert.ok(cleanupJob.scheduledTime);
  cleanup(dir);
});

test("Scheduler - Execute Cleanup Job", async () => {
  const dir = setupTest();
  const scheduler = new Scheduler();
  const orderStore = new OrderStore();
  const order = orderStore.create({
    quantity: 1,
    deliveryTime: new Date().toISOString(),
    phone: "13800138000",
  });

  orderStore.update(order.id, { status: ORDER_STATUS.PAYMENT_PENDING });
  orderStore.update(order.id, { status: ORDER_STATUS.PROVISIONING_SCHEDULED });
  orderStore.update(order.id, { status: ORDER_STATUS.PROVISIONING_STARTED });
  orderStore.update(order.id, {
    status: ORDER_STATUS.PROVISIONED,
    ec2InstanceId: "i-mock-cleanup",
    dnsRecordName: "abc123.clawparty.ai",
    dnsRecordValue: "203.0.113.42",
  });

  const job = scheduler.createCleanupJob(order.id, "provision-job-123", 0);
  await scheduler.executeCleanupJob(job);

  const updatedOrder = orderStore.findById(order.id);
  const completedJob = scheduler
    .readJobs()
    .find((existingJob) => existingJob.id === job.id);

  assert.strictEqual(updatedOrder.status, ORDER_STATUS.COMPLETE);
  assert.ok(updatedOrder.cleanedUpAt);
  assert.strictEqual(completedJob.status, "completed");
  assert.strictEqual(completedJob.result.cleanedUp, true);
  cleanup(dir);
});

test("Webhook - Mock Payment Success", async () => {
  const dir = setupTest();
  const app = createApp();
  const orderStore = new OrderStore();
  const order = orderStore.create({
    quantity: 1,
    deliveryTime: "2026-03-12T15:30:00Z",
    phone: "13800138000",
  });
  await request(app)
    .post(`/api/orders/${order.id}/payment-session`)
    .send({});
  const res = await request(app)
    .post("/webhooks/mock/payment-success")
    .send({ orderId: order.id });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.success, true);
  assert.ok(res.body.provisionJobId);
  assert.ok(res.body.cleanupJobId);
  cleanup(dir);
});

test("Webhook - Signed Youzan Payment Callback", async () => {
  const dir = setupTest();
  const secret = "test-youzan-secret";
  process.env.YOUZAN_CLIENT_SECRET = secret;
  process.env.YOUZAN_WEBHOOK_SKEW_SECONDS = "300";

  try {
    const app = createApp();
    const orderStore = new OrderStore();
    const order = orderStore.create({
      quantity: 1,
      deliveryTime: "2026-03-12T15:30:00Z",
      phone: "13800138000",
    });

    await request(app)
      .post(`/api/orders/${order.id}/payment-session`)
      .send({});

    const timestamp = Math.floor(Date.now() / 1000);
    const payload = `{
  "orderId": "${order.id}",
  "status": "paid"
}`;
    const signature = crypto
      .createHmac("sha256", secret)
      .update(payload)
      .digest("hex");

    const res = await request(app)
      .post("/webhooks/youzan/payment-callback")
      .set("content-type", "application/json")
      .set("x-youzan-signature", signature)
      .set("x-youzan-timestamp", String(timestamp))
      .send(payload);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);

    const updatedOrder = orderStore.findById(order.id);
    assert.strictEqual(updatedOrder.status, ORDER_STATUS.PROVISIONING_SCHEDULED);
    assert.ok(updatedOrder.provisionJobId);
    assert.ok(updatedOrder.cleanupJobId);
  } finally {
    delete process.env.YOUZAN_CLIENT_SECRET;
    delete process.env.YOUZAN_WEBHOOK_SKEW_SECONDS;
    cleanup(dir);
  }
});
