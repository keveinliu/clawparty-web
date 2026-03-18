const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const { ORDER_STATUS, canTransition } = require("../constants/orderStatus");
const { getEnv } = require("../config/env");

const env = getEnv();

class OrderStore {
  constructor() {
    this.dataDir = env.dataDir;
    this.ordersFile = path.join(this.dataDir, "orders.json");
    this.ensureDataDir();
    this.ensureOrdersFile();
  }

  ensureDataDir() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  ensureOrdersFile() {
    if (!fs.existsSync(this.ordersFile)) {
      fs.writeFileSync(this.ordersFile, JSON.stringify([], null, 2));
    }
  }

  readOrders() {
    try {
      const data = fs.readFileSync(this.ordersFile, "utf-8");
      return JSON.parse(data);
    } catch (err) {
      return [];
    }
  }

  writeOrders(orders) {
    fs.writeFileSync(this.ordersFile, JSON.stringify(orders, null, 2));
  }

  create(data) {
    const orders = this.readOrders();
    const order = {
      id: uuidv4(),
      status: ORDER_STATUS.CREATED,
      quantity: data.quantity,
      deliveryTime: data.deliveryTime,
      email: data.email || null,
      phone: data.phone,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      paymentSessionId: null,
      provisionJobId: null,
      cleanupJobId: null,
      ec2InstanceId: null,
      dnsRecordId: null,
      dnsRecordName: null,
      dnsRecordValue: null,
      provisionedAt: null,
      cleanupScheduledTime: null,
      cleanedUpAt: null,
      checkoutUrl: null,
      paymentProvider: null,
      paymentQrId: null,
      paymentQrCodeUrl: null,
      paymentQrUrl: null,
      idempotencyKey: data.idempotencyKey || null,
    };
    orders.push(order);
    this.writeOrders(orders);
    return order;
  }

  findById(id) {
    const orders = this.readOrders();
    return orders.find((o) => o.id === id);
  }

  findByIdempotencyKey(key) {
    const orders = this.readOrders();
    return orders.find((o) => o.idempotencyKey === key);
  }

  update(id, updates) {
    const orders = this.readOrders();
    const idx = orders.findIndex((o) => o.id === id);
    if (idx === -1) {
      throw new Error(`Order ${id} not found`);
    }

    const order = orders[idx];
    const newStatus = updates.status || order.status;

    if (!canTransition(order.status, newStatus)) {
      throw new Error(
        `Cannot transition from ${order.status} to ${newStatus}`
      );
    }

    orders[idx] = {
      ...order,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    this.writeOrders(orders);
    return orders[idx];
  }

  list() {
    return this.readOrders();
  }
}

module.exports = {
  OrderStore,
  ORDER_STATUS,
};
