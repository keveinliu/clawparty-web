const express = require("express");
const axios = require("axios");
const { YouzanVerification } = require("../services/youzanVerification");
const { YouzanPaymentService } = require("../services/youzanPayment");
const { OrderStore, ORDER_STATUS } = require("../models/order");
const { Scheduler } = require("../scheduler");
const { logInfo, logWarn, logError } = require("../utils/logger");

const router = express.Router();
const orderStore = new OrderStore();
const youzanPaymentService = new YouzanPaymentService();

async function fetchYouzanQrId(tid) {
  try {
    const accessToken = await youzanPaymentService.getAccessToken();
    const env = youzanPaymentService.env;
    const url = `${env.youzanApiBaseUrl}/youzan.trade.get/4.0.0`;
    const resp = await axios.get(url, {
      params: { access_token: accessToken, tid },
      timeout: env.youzanRequestTimeoutMs,
    });
    const body = resp.data || {};
    if (!body.success || !body.response) return null;
    return body.response.qr_info?.qr_id || null;
  } catch (err) {
    logError("youzan.trade.get.error", err, { tid });
    return null;
  }
}

function findOrderByQrId(qrId) {
  const orders = orderStore.list();
  return orders.find((o) => o.paymentQrId === qrId) || null;
}

function scheduleJobs(orderId, order) {
  const scheduler = new Scheduler();
  const provisionJob = scheduler.createProvisionJob(orderId, order.deliveryTime);
  const cleanupJob = scheduler.createCleanupJob(orderId, provisionJob.id, Number(order.quantity));
  orderStore.update(orderId, {
    status: ORDER_STATUS.PROVISIONING_SCHEDULED,
    provisionJobId: provisionJob.id,
    cleanupJobId: cleanupJob.id,
  });
  logInfo("youzan.webhook.jobs_scheduled", { orderId, provisionJobId: provisionJob.id, cleanupJobId: cleanupJob.id });
}

router.post("/youzan/payment-callback", express.raw({ type: "*/*" }), async (req, res) => {
  try {
    const rawBody = Buffer.isBuffer(req.body)
      ? req.body.toString("utf-8")
      : typeof req.body === "string"
        ? req.body
        : JSON.stringify(req.body);

    const eventSign = req.headers["event-sign"];
    const eventType = req.headers["event-type"];

    logInfo("youzan.webhook.received", { eventType, eventSign: eventSign?.slice(0, 8) + "..." });

    const verification = new YouzanVerification().verify(rawBody, eventSign);
    if (!verification.valid) {
      logWarn("youzan.webhook.verification_failed", { reason: verification.reason, eventType });
      return res.status(401).json({ error: "Webhook verification failed", reason: verification.reason });
    }

    const data = JSON.parse(rawBody);
    const tid = data.id;
    const youzanStatus = data.status;

    logInfo("youzan.webhook.parsed", { tid, type: data.type, status: youzanStatus, kdt_id: data.kdt_id });

    if (!["TRADE_PAID", "WAIT_SELLER_SEND_GOODS"].includes(youzanStatus)) {
      logInfo("youzan.webhook.ignored", { tid, status: youzanStatus });
      return res.json({ success: true, ignored: true });
    }

    let order = null;

    if (youzanPaymentService.hasApiCredentials()) {
      const qrId = await fetchYouzanQrId(tid);
      logInfo("youzan.webhook.qr_lookup", { tid, qrId });
      if (qrId) {
        order = findOrderByQrId(qrId);
      }
    }

    if (!order) {
      order = orderStore.findLatestPaymentPending();
      logInfo("youzan.webhook.fallback_match", { tid, orderId: order?.id || null });
    }

    if (!order) {
      logWarn("youzan.webhook.no_order_found", { tid });
      return res.status(404).json({ error: "No matching order found" });
    }

    if (order.status !== ORDER_STATUS.PAYMENT_PENDING) {
      logWarn("youzan.webhook.order_not_pending", { orderId: order.id, status: order.status });
      return res.json({ success: true, orderId: order.id, skipped: true });
    }

    orderStore.update(order.id, { youzanTid: tid });
    scheduleJobs(order.id, order);

    logInfo("youzan.webhook.success", { orderId: order.id, tid });
    return res.json({ success: true, orderId: order.id });

  } catch (err) {
    logError("youzan.webhook.error", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/mock/payment-success", express.json(), (req, res) => {
  try {
    const { orderId } = req.body;

    if (!orderId) {
      return res.status(400).json({ error: "Missing orderId" });
    }

    const order = orderStore.findById(orderId);
    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    if (order.status !== ORDER_STATUS.PAYMENT_PENDING) {
      return res.status(400).json({ error: `Cannot process payment for order in status: ${order.status}` });
    }

    scheduleJobs(orderId, order);

    logInfo("mock.payment_success", { orderId });
    return res.json({
      success: true,
      orderId,
      status: ORDER_STATUS.PROVISIONING_SCHEDULED,
    });
  } catch (err) {
    logError("mock.payment_success.error", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
