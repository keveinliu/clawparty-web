const express = require("express");
const { AlipayService } = require("../services/alipayService");
const { WechatPayService } = require("../services/wechatPayService");
const { OrderStore, ORDER_STATUS } = require("../models/order");
const { Scheduler } = require("../scheduler");
const { logInfo, logWarn, logError } = require("../utils/logger");

const router = express.Router();
const orderStore = new OrderStore();
const alipayService = new AlipayService();
const wechatPayService = new WechatPayService();

function scheduleJobs(orderId, order) {
  const scheduler = new Scheduler();
  const provisionJob = scheduler.createProvisionJob(orderId, order.deliveryTime);
  const cleanupJob = scheduler.createCleanupJob(orderId, provisionJob.id, Number(order.quantity));
  orderStore.update(orderId, {
    status: ORDER_STATUS.PROVISIONING_SCHEDULED,
    provisionJobId: provisionJob.id,
    cleanupJobId: cleanupJob.id,
  });
  logInfo("payment.jobs_scheduled", { orderId, provisionJobId: provisionJob.id, cleanupJobId: cleanupJob.id });
}

function handlePaymentSuccess(outTradeNo, transactionId, provider) {
  const orders = orderStore.list();
  const order = orders.find((o) => o.paymentSessionId === outTradeNo) || null;
  if (!order) {
    logWarn("payment.notify.order_not_found", { outTradeNo, provider });
    return false;
  }
  if (order.status !== ORDER_STATUS.PAYMENT_PENDING) {
    logWarn("payment.notify.order_not_pending", { orderId: order.id, status: order.status });
    return true;
  }
  orderStore.update(order.id, { paymentTransactionId: transactionId });
  scheduleJobs(order.id, order);
  logInfo("payment.notify.success", { orderId: order.id, outTradeNo, provider, transactionId });
  return true;
}

router.post("/alipay/notify", express.urlencoded({ extended: false }), (req, res) => {
  try {
    const valid = alipayService.verifyNotify(req.body);
    if (!valid) {
      logWarn("alipay.notify.invalid_sign");
      return res.send("fail");
    }
    const { trade_status, out_trade_no, trade_no } = req.body;
    logInfo("alipay.notify.received", { trade_status, out_trade_no, trade_no });
    if (trade_status === "TRADE_SUCCESS" || trade_status === "TRADE_FINISHED") {
      handlePaymentSuccess(out_trade_no, trade_no, "alipay");
    }
    res.send("success");
  } catch (err) {
    logError("alipay.notify.error", err);
    res.send("fail");
  }
});

router.post("/wechat/notify", express.raw({ type: "application/json" }), (req, res) => {
  try {
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf-8") : req.body;
    const order = wechatPayService.verifyNotify(req.headers, rawBody);
    logInfo("wechat.notify.received", {
      trade_state: order.trade_state,
      out_trade_no: order.out_trade_no,
      transaction_id: order.transaction_id,
    });
    if (order.trade_state === "SUCCESS") {
      handlePaymentSuccess(order.out_trade_no, order.transaction_id, "wechat");
    }
    res.json({ code: "SUCCESS", message: "成功" });
  } catch (err) {
    logError("wechat.notify.error", err);
    res.status(400).json({ code: "FAIL", message: err.message });
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
      return res.status(400).json({ error: `Order status is ${order.status}` });
    }
    scheduleJobs(orderId, order);
    logInfo("mock.payment_success", { orderId });
    res.json({ success: true, orderId, status: ORDER_STATUS.PROVISIONING_SCHEDULED });
  } catch (err) {
    logError("mock.payment_success.error", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
