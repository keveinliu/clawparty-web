# Provision Agent

## Overview

The Provision Agent creates EC2 and DNS resources at delivery time.

## Trigger

- Job type: `provision`
- Condition: `scheduledTime <= now`

## Workflow

1. Receive provision job (`orderId`, `scheduledTime`).
2. Resolve latest Ubuntu 24.04 AMI from SSM.
3. Launch EC2 instance with order tags.
4. Obtain public IP.
5. Create Route53 A record: `{orderId-prefix}.{AWS_DOMAIN_SUFFIX}`.
6. Update order (`ec2InstanceId`, `dnsRecordId`, `status=provisioned`).
7. Mark provision job as completed.

## Downstream Dependency

After successful provisioning, scheduler derives cleanup time using:

```text
cleanupScheduledTime = provisionCompletedAt + quantity * 1h
```

and activates the linked `cleanup` job.

## Error Handling

- Transient AWS errors: retry.
- Persistent errors: mark order/job as failed.

## Idempotency

- If order already has active resource metadata, avoid duplicate resource creation.

## Mock Mode

- Returns deterministic mock values (`i-mock-*`, `203.0.113.42`, mock DNS id).

## Validation Checklist

- EC2 instance created successfully.
- DNS A record exists and points to instance IP.
- Order and job states updated consistently.
