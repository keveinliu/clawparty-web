#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { getEnv } = require("./config/env");
const { OrderStore } = require("./models/order");

const env = getEnv();

function readJobs() {
  const jobsFile = path.join(env.dataDir, "jobs.json");
  try {
    const data = fs.readFileSync(jobsFile, "utf-8");
    return JSON.parse(data);
  } catch (err) {
    return [];
  }
}

function formatDate(isoString) {
  if (!isoString) return "N/A";
  const date = new Date(isoString);
  return date.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
}

function listOrders() {
  const orderStore = new OrderStore();
  const orders = orderStore.list();

  console.log("\n=== 订单列表 ===\n");
  console.log(`总计: ${orders.length} 个订单\n`);

  if (orders.length === 0) {
    console.log("暂无订单");
    return;
  }

  orders.forEach((order, index) => {
    console.log(`[${index + 1}] 订单ID: ${order.id}`);
    console.log(`    状态: ${order.status}`);
    console.log(`    数量: ${order.quantity} 小时`);
    console.log(`    手机: ${order.phone}`);
    console.log(`    配送时间: ${formatDate(order.deliveryTime)}`);
    console.log(`    创建时间: ${formatDate(order.createdAt)}`);
    if (order.provisionJobId) {
      console.log(`    Provision Job: ${order.provisionJobId}`);
    }
    if (order.cleanupJobId) {
      console.log(`    Cleanup Job: ${order.cleanupJobId}`);
    }
    if (order.ec2InstanceId) {
      console.log(`    EC2 实例: ${order.ec2InstanceId}`);
    }
    if (order.dnsRecordId) {
      console.log(`    DNS 记录: ${order.dnsRecordId}`);
    }
    console.log("");
  });
}

function listJobs() {
  const jobs = readJobs();

  console.log("\n=== 任务列表 ===\n");
  console.log(`总计: ${jobs.length} 个任务\n`);

  if (jobs.length === 0) {
    console.log("暂无任务");
    return;
  }

  const pending = jobs.filter((j) => j.status === "pending");
  const completed = jobs.filter((j) => j.status === "completed");
  const failed = jobs.filter((j) => j.status === "failed");

  console.log(`待执行: ${pending.length} | 已完成: ${completed.length} | 失败: ${failed.length}\n`);

  jobs.forEach((job, index) => {
    const statusIcon =
      job.status === "completed" ? "✅" : job.status === "failed" ? "❌" : "⏳";
    console.log(`[${index + 1}] ${statusIcon} ${job.type.toUpperCase()}`);
    console.log(`    任务ID: ${job.id}`);
    console.log(`    订单ID: ${job.orderId}`);
    console.log(`    状态: ${job.status}`);
    console.log(`    计划时间: ${formatDate(job.scheduledTime)}`);
    console.log(`    创建时间: ${formatDate(job.createdAt)}`);
    if (job.completedAt) {
      console.log(`    完成时间: ${formatDate(job.completedAt)}`);
    }
    if (job.type === "cleanup" && job.afterJobId) {
      console.log(`    依赖任务: ${job.afterJobId}`);
      console.log(`    延迟小时: ${job.delayHours || "N/A"}`);
    }
    if (job.result) {
      console.log(`    结果: ${JSON.stringify(job.result)}`);
    }
    console.log("");
  });
}

function showSchedulerStatus() {
  const jobs = readJobs();
  const orderStore = new OrderStore();
  const orders = orderStore.list();

  console.log("\n=== 调度器状态 ===\n");
  console.log(`Cron 表达式: ${env.schedulerCron}`);
  console.log(`数据目录: ${env.dataDir}`);
  console.log(`AWS 启用: ${env.awsEnabled ? "是" : "否"}\n`);

  const now = new Date();
  const pendingJobs = jobs.filter((j) => j.status === "pending");
  const overdueJobs = pendingJobs.filter(
    (j) => new Date(j.scheduledTime) <= now
  );

  console.log(`订单总数: ${orders.length}`);
  console.log(`任务总数: ${jobs.length}`);
  console.log(`待执行任务: ${pendingJobs.length}`);
  console.log(`逾期任务: ${overdueJobs.length}\n`);

  if (overdueJobs.length > 0) {
    console.log("⚠️  逾期任务列表:");
    overdueJobs.forEach((job) => {
      console.log(`  - ${job.type} (${job.id}) - 计划时间: ${formatDate(job.scheduledTime)}`);
    });
    console.log("");
  }

  const upcomingJobs = pendingJobs
    .filter((j) => new Date(j.scheduledTime) > now)
    .sort((a, b) => new Date(a.scheduledTime) - new Date(b.scheduledTime))
    .slice(0, 5);

  if (upcomingJobs.length > 0) {
    console.log("📅 即将执行的任务 (最近5个):");
    upcomingJobs.forEach((job) => {
      console.log(`  - ${job.type} (${job.id}) - 计划时间: ${formatDate(job.scheduledTime)}`);
    });
    console.log("");
  }
}

function showHelp() {
  console.log("\nClawparty CLI 工具\n");
  console.log("用法: npm run cli <command>\n");
  console.log("可用命令:");
  console.log("  list-orders          列出所有订单");
  console.log("  list-jobs            列出所有任务");
  console.log("  show-scheduler       显示调度器状态");
  console.log("  help                 显示帮助信息\n");
}

const command = process.argv[2];

switch (command) {
  case "list-orders":
    listOrders();
    break;
  case "list-jobs":
    listJobs();
    break;
  case "show-scheduler":
    showSchedulerStatus();
    break;
  case "help":
  case undefined:
    showHelp();
    break;
  default:
    console.error(`\n未知命令: ${command}\n`);
    showHelp();
    process.exit(1);
}
