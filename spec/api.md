# API Specification

## Overview

Clawparty API handles order lifecycle, payment callbacks, and AWS automation job scheduling.

## Base URL

```text
http://localhost:3000/api
```

## Orders

### Create Order

**POST** `/orders`

Request body:

```json
{
  "quantity": 2,
  "deliveryTime": "2026-03-12T15:30:00Z",
  "phone": "13800138000",
  "email": "user@example.com",
  "idempotencyKey": "optional-unique-key"
}
```

Response (`201`):

```json
{
  "id": "uuid",
  "status": "created",
  "quantity": 2,
  "deliveryTime": "2026-03-12T15:30:00Z",
  "phone": "13800138000",
  "email": "user@example.com",
  "paymentTransactionId": null,
  "provisionJobId": null,
  "cleanupJobId": null,
  "ec2InstanceId": null,
  "dnsRecordId": null,
  "cleanupScheduledTime": null,
  "cleanedUpAt": null,
  "idempotencyKey": "optional-unique-key"
}
```

### Get Order

**GET** `/orders/:id`

Returns the current order snapshot including job IDs and resource metadata.

### List Orders

**GET** `/orders`

Returns all orders.

### Create Payment QR Code

**POST** `/orders/:id/payment-qrcode`

Request body:

```json
{
  "paymentMethod": "alipay" // or "wechat"
}
```

Transitions order to `payment_pending`.

Response (`200`):

```json
{
  "qrDataUrl": "data:image/png;base64,...",
  "outTradeNo": "uuid",
  "provider": "alipay",
  "mock": false
}
```

### Mark Payment Success

**POST** `/orders/:id/payment-success`

Schedules two jobs:

1. `provision` at order `deliveryTime`
2. `cleanup` delayed by `quantity` hours after provision success

Response (`200`):

```json
{
  "orderId": "uuid",
  "status": "provisioning_scheduled",
  "provisionJobId": "uuid",
  "cleanupJobId": "uuid",
  "cleanupDelayHours": 2
}
```

## Webhooks

### Alipay Payment Notify

**POST** `/webhooks/alipay/notify`

Content-Type: `application/x-www-form-urlencoded`

Verification rule:
Verifies RSA2 signature using `ALIPAY_PUBLIC_KEY`.

On success, schedules the same provision + cleanup jobs as `/orders/:id/payment-success`.

### WeChat Pay Notification

**POST** `/webhooks/wechat/notify`

Content-Type: `application/json`

Headers:
- `Wechatpay-Signature`
- `Wechatpay-Timestamp`
- `Wechatpay-Nonce`
- `Wechatpay-Serial`

Verification rule:
Verifies RSA signature using `WECHAT_PAY_PUBKEY` and decrypts AES-GCM payload using `WECHAT_PAY_API_V3_KEY`.

On success, schedules the same provision + cleanup jobs as `/orders/:id/payment-success`.

### Mock Payment Success

**POST** `/webhooks/mock/payment-success`

Body:

```json
{
  "orderId": "uuid"
}
```

## Lifecycle Semantics

Order execution lifecycle:

```text
created -> payment_pending -> provisioning_scheduled -> provisioning_started -> provisioned -> complete
```

Operational rule:

- Resources stay active while order is `provisioned`.
- Cleanup executes after `quantity` hours and transitions order to `complete`.
- Any provision/cleanup failure transitions order to `failed`.

## Error Response

```json
{
  "error": "Error message"
}
```

Common status codes: `400`, `404`, `500`.
