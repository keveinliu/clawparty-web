const express = require("express");
const { YouzanVerification } = require("../services/youzanVerification");
const { OrderStore, ORDER_STATUS } = require("../models/order");
const { Scheduler } = require("../scheduler");

const router = express.Router();
const orderStore = new OrderStore();

router.post("/youzan/payment-callback", express.raw({ type: "*/*" }), (req, res) => {
  try {
    console.log("=== [youzan webhook] START ===");
    console.log("[youzan webhook] method:", req.method);
    console.log("[youzan webhook] url:", req.url);
    console.log("[youzan webhook] headers:", JSON.stringify(req.headers, null, 2));
    console.log("[youzan webhook] body type:", typeof req.body);
    console.log("[youzan webhook] body buffer:", Buffer.isBuffer(req.body));
    
    const rawBody = Buffer.isBuffer(req.body)
      ? req.body.toString("utf-8")
      : typeof req.body === "string"
        ? req.body
        : JSON.stringify(req.body);
    
    console.log("[youzan webhook] raw body:", rawBody);

    const signature = req.headers["x-youzan-signature"];
    const timestamp = req.headers["x-youzan-timestamp"];

    if (!signature || !timestamp) {
      console.warn("[youzan webhook] missing headers");
      console.warn("  - signature:", signature);
      console.warn("  - timestamp:", timestamp);
      console.warn("  - all header keys:", Object.keys(req.headers));
      return res.status(400).json({
        error: "Missing signature or timestamp header",
        receivedHeaders: Object.keys(req.headers),
      });
    }

    const parsedTimestamp = Number(timestamp);
    if (!Number.isFinite(parsedTimestamp)) {
      console.warn("[youzan webhook] invalid timestamp value:", timestamp);
      return res.status(400).json({
        error: "Invalid timestamp header",
      });
    }

    const verification = new YouzanVerification().verify(
      rawBody,
      signature,
      parsedTimestamp
    );

    if (!verification.valid) {
      console.warn("[youzan webhook] verification failed:", verification.reason);
      console.warn("  - signature received:", signature);
      console.warn("  - timestamp received:", timestamp);
      console.warn("  - body used for verification:", rawBody);
      return res.status(401).json({
        error: "Webhook verification failed",
        reason: verification.reason,
      });
    }

    const data = JSON.parse(rawBody);
    console.log("[youzan webhook] parsed payload:", JSON.stringify(data, null, 2));
    console.log("=== [youzan webhook] END ===");

    const { orderId, status, transactionId } = data;

    if (!orderId) {
      return res.status(400).json({
        error: "Missing orderId in webhook payload",
      });
    }

    const order = orderStore.findById(orderId);
    if (!order) {
      return res.status(404).json({
        error: "Order not found",
      });
    }

    if (status === "paid") {
      if (order.status !== ORDER_STATUS.PAYMENT_PENDING) {
        return res.status(400).json({
          error: `Cannot process payment for order in status: ${order.status}`,
        });
      }

      const scheduler = new Scheduler();
      const provisionJob = scheduler.createProvisionJob(orderId, order.deliveryTime);
      const cleanupJob = scheduler.createCleanupJob(
        orderId,
        provisionJob.id,
        Number(order.quantity)
      );

      orderStore.update(orderId, {
        status: ORDER_STATUS.PROVISIONING_SCHEDULED,
        provisionJobId: provisionJob.id,
        cleanupJobId: cleanupJob.id,
      });

      console.log(`Payment confirmed for order ${orderId}, jobs scheduled`);
    }

    res.json({
      success: true,
      orderId,
      status,
    });
  } catch (err) {
    console.error("Webhook processing error:", err.message);
    res.status(500).json({
      error: err.message,
    });
  }
});

router.post("/mock/payment-success", express.json(), (req, res) => {
  try {
    const { orderId } = req.body;

    if (!orderId) {
      return res.status(400).json({
        error: "Missing orderId",
      });
    }

    const order = orderStore.findById(orderId);
    if (!order) {
      return res.status(404).json({
        error: "Order not found",
      });
    }

    if (order.status !== ORDER_STATUS.PAYMENT_PENDING) {
      return res.status(400).json({
        error: `Cannot process payment for order in status: ${order.status}`,
      });
    }

    const scheduler = new Scheduler();
    const provisionJob = scheduler.createProvisionJob(orderId, order.deliveryTime);
    const cleanupJob = scheduler.createCleanupJob(
      orderId,
      provisionJob.id,
      Number(order.quantity)
    );

    orderStore.update(orderId, {
      status: ORDER_STATUS.PROVISIONING_SCHEDULED,
      provisionJobId: provisionJob.id,
      cleanupJobId: cleanupJob.id,
    });

    console.log(`Mock payment success for order ${orderId}`);

    res.json({
      success: true,
      orderId,
      status: ORDER_STATUS.PROVISIONING_SCHEDULED,
      provisionJobId: provisionJob.id,
      cleanupJobId: cleanupJob.id,
    });
  } catch (err) {
    console.error("Mock payment error:", err.message);
    res.status(500).json({
      error: err.message,
    });
  }
});

module.exports = router;
