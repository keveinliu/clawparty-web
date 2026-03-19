const express = require("express");
const { v4: uuidv4 } = require("uuid");
const { OrderStore, ORDER_STATUS } = require("../models/order");
const { Scheduler } = require("../scheduler");
const { PaymentService } = require("../services/paymentService");
const { EmailService } = require("../services/emailService");
const { logInfo, logWarn, logError } = require("../utils/logger");

const router = express.Router();
const orderStore = new OrderStore();
const paymentService = new PaymentService();
const emailService = new EmailService();

router.post("/orders", async (req, res) => {
  try {
    const { quantity, deliveryTime, email, phone, idempotencyKey } = req.body;

    if (!quantity || !deliveryTime || !email || !phone) {
      return res.status(400).json({
        error: "Missing required fields: quantity, deliveryTime, email, phone",
      });
    }

    if (idempotencyKey) {
      const existing = orderStore.findByIdempotencyKey(idempotencyKey);
      if (existing) {
        return res.status(200).json(existing);
      }
    }

    const order = orderStore.create({
      quantity,
      deliveryTime,
      email,
      phone,
      idempotencyKey: idempotencyKey || null,
    });

    logInfo("order.create.success", {
      orderId: order.id,
      quantity: order.quantity,
      deliveryTime: order.deliveryTime,
      email: order.email,
    });

    res.status(201).json(order);

    emailService.sendOrderCreatedEmail(order).catch((err) => {
      logError("email.order_created.unhandled", err, { orderId: order.id });
    });
  } catch (err) {
    logError("order.create.error", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/orders/:id", (req, res) => {
  try {
    const order = orderStore.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }
    res.json(order);
  } catch (err) {
    logError("order.get.error", err, { orderId: req.params.id });
    res.status(500).json({ error: err.message });
  }
});

router.get("/orders", (req, res) => {
  try {
    const orders = orderStore.list();
    res.json(orders);
  } catch (err) {
    logError("order.list.error", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/orders/:id/payment-qrcode", async (req, res) => {
  try {
    const { paymentMethod } = req.body;

    if (!["alipay", "wechat"].includes(paymentMethod)) {
      return res.status(400).json({ error: "paymentMethod must be alipay or wechat" });
    }

    const order = orderStore.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    if (order.status !== ORDER_STATUS.CREATED && order.status !== ORDER_STATUS.PAYMENT_PENDING) {
      return res.status(400).json({
        error: `Cannot create payment for order in status: ${order.status}`,
      });
    }

    const { qrDataUrl, outTradeNo, provider, mock } = await paymentService.createQrCode({
      orderId: order.id,
      quantity: order.quantity,
      paymentMethod,
    });

    orderStore.update(req.params.id, {
      status: ORDER_STATUS.PAYMENT_PENDING,
      paymentSessionId: outTradeNo,
      paymentProvider: provider,
    });

    logInfo("order.payment_qrcode.success", { orderId: order.id, provider, mock });

    res.json({ qrDataUrl, outTradeNo, provider, mock });
  } catch (err) {
    logError("order.payment_qrcode.error", err, { orderId: req.params.id });
    res.status(500).json({ error: err.message });
  }
});

router.post("/orders/:id/payment-success", (req, res) => {
  try {
    const order = orderStore.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    if (order.status !== ORDER_STATUS.PAYMENT_PENDING) {
      return res.status(400).json({
        error: `Cannot mark payment success for order in status: ${order.status}`,
      });
    }

    const scheduler = new Scheduler();
    const provisionJob = scheduler.createProvisionJob(req.params.id, order.deliveryTime);
    const cleanupJob = scheduler.createCleanupJob(req.params.id, provisionJob.id, Number(order.quantity));

    orderStore.update(req.params.id, {
      status: ORDER_STATUS.PROVISIONING_SCHEDULED,
      provisionJobId: provisionJob.id,
      cleanupJobId: cleanupJob.id,
    });

    logInfo("order.payment_success", { orderId: req.params.id });

    res.json({
      orderId: req.params.id,
      status: ORDER_STATUS.PROVISIONING_SCHEDULED,
      provisionJobId: provisionJob.id,
      cleanupJobId: cleanupJob.id,
    });
  } catch (err) {
    logError("order.payment_success.error", err, { orderId: req.params.id });
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
