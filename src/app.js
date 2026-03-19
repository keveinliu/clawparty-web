const express = require("express");
const path = require("path");
const apiRoutes = require("./routes/api");
const webhookRoutes = require("./routes/webhooks");
const { OrderStore } = require("./models/order");

function createApp() {
  const app = express();
  const orderStore = new OrderStore();

  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "..", "views"));

  app.use(express.static(path.join(__dirname, "..", "public")));
  app.use("/webhooks", webhookRoutes);
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.get("/", (req, res) => {
    res.render("index");
  });

  app.get("/checkout", (req, res) => {
    res.render("checkout");
  });

  app.get("/payment", (req, res) => {
    const { orderId } = req.query;
    if (!orderId) {
      return res.redirect("/");
    }
    const order = orderStore.findById(orderId);
    if (!order) {
      return res.redirect("/?error=OrderNotFound");
    }
    res.render("payment", { 
      orderId: order.id, 
      quantity: order.quantity, 
      deliveryTime: order.deliveryTime 
    });
  });

  app.get("/success", (req, res) => {
    const { orderId, checkoutUrl } = req.query;
    res.render("success", { orderId, checkoutUrl });
  });

  app.get("/error", (req, res) => {
    const { message } = req.query;
    res.render("error", { message: message || "An error occurred" });
  });

  app.use("/api", apiRoutes);

  app.use((err, req, res, next) => {
    console.error("Error:", err.message);
    res.status(500).json({
      error: err.message,
    });
  });

  return app;
}

module.exports = {
  createApp,
};
