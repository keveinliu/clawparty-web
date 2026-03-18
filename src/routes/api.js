const express = require("express");
const { v4: uuidv4 } = require("uuid");
const { OrderStore, ORDER_STATUS } = require("../models/order");
const { Scheduler } = require("../scheduler");
const { YouzanPaymentService } = require("../services/youzanPayment");
const { EmailService } = require("../services/emailService");
const { logInfo, logWarn, logError } = require("../utils/logger");

const router = express.Router();
const orderStore = new OrderStore();
const youzanPaymentService = new YouzanPaymentService();
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

router.post("/orders/:id/payment-session", async (req, res) => {
  try {
    const order = orderStore.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    if (
      order.status !== ORDER_STATUS.CREATED &&
      order.status !== ORDER_STATUS.PAYMENT_PENDING
    ) {
      return res.status(400).json({
        error: `Cannot create payment session for order in status: ${order.status}`,
      });
    }

    const hasReusableSession =
      order.status === ORDER_STATUS.PAYMENT_PENDING &&
      Boolean(order.paymentSessionId) &&
      Boolean(order.checkoutUrl);

    if (hasReusableSession) {
      logInfo("order.payment_session.reused", {
        orderId: req.params.id,
        paymentSessionId: order.paymentSessionId,
        provider: order.paymentProvider,
      });

      return res.json({
        paymentSessionId: order.paymentSessionId,
        checkoutUrl: order.checkoutUrl,
        provider: order.paymentProvider,
        qrCodeUrl: order.paymentQrCodeUrl,
        qrUrl: order.paymentQrUrl,
        reused: true,
        fromCache: true,
      });
    }

    const paymentSessionId = order.paymentSessionId || uuidv4();
    const session = await youzanPaymentService.createPaymentSession(
      order,
      paymentSessionId
    );

    const updatedOrder = orderStore.update(req.params.id, {
      status: ORDER_STATUS.PAYMENT_PENDING,
      paymentSessionId: session.paymentSessionId,
      checkoutUrl: session.checkoutUrl || null,
      paymentProvider: session.provider || null,
      paymentQrId: session.qrId || null,
      paymentQrCodeUrl: session.qrCodeUrl || null,
      paymentQrUrl: session.qrUrl || null,
    });

    if (!updatedOrder.checkoutUrl) {
      logWarn("order.payment_session.missing_checkout_url", {
        orderId: req.params.id,
        paymentSessionId: session.paymentSessionId,
      });
      return res.status(502).json({
        error: "Payment link generation failed",
      });
    }

    logInfo("order.payment_session.success", {
      orderId: req.params.id,
      paymentSessionId: updatedOrder.paymentSessionId,
      provider: updatedOrder.paymentProvider,
      mode: session.mode,
      reused: Boolean(order.paymentSessionId),
    });

    res.json({
      paymentSessionId: updatedOrder.paymentSessionId,
      checkoutUrl: updatedOrder.checkoutUrl,
      provider: updatedOrder.paymentProvider,
      qrCodeUrl: updatedOrder.paymentQrCodeUrl,
      qrUrl: updatedOrder.paymentQrUrl,
      reused: Boolean(order.paymentSessionId),
      fromCache: false,
    });
  } catch (err) {
    logError("order.payment_session.error", err, { orderId: req.params.id });
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
    const provisionJob = scheduler.createProvisionJob(
      req.params.id,
      order.deliveryTime
    );
    const cleanupJob = scheduler.createCleanupJob(
      req.params.id,
      provisionJob.id,
      Number(order.quantity)
    );

    orderStore.update(req.params.id, {
      status: ORDER_STATUS.PROVISIONING_SCHEDULED,
      provisionJobId: provisionJob.id,
      cleanupJobId: cleanupJob.id,
    });

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
