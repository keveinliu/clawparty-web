const {
  EC2Client,
  RunInstancesCommand,
  StopInstancesCommand,
} = require("@aws-sdk/client-ec2");
const { Route53Client, ChangeResourceRecordSetsCommand } = require("@aws-sdk/client-route-53");
const { SSMClient, GetParameterCommand } = require("@aws-sdk/client-ssm");
const { getEnv } = require("../config/env");
const { logInfo, logWarn, logError } = require("../utils/logger");

const env = getEnv();

class AWSProvisioning {
  constructor() {
    this.enabled = env.awsEnabled;
    if (this.enabled) {
      this.ec2 = new EC2Client({ region: env.awsRegion });
      this.route53 = new Route53Client({ region: env.awsRegion });
      this.ssm = new SSMClient({ region: env.awsRegion });
    }
  }

  async getLatestUbuntuAmi() {
    if (!this.enabled) {
      logInfo("aws.ssm.get_parameter.mock", {
        amiId: "ami-mock-ubuntu-24",
      });
      return "ami-mock-ubuntu-24";
    }

    try {
      logInfo("aws.ssm.get_parameter.request", {
        name: env.awsAmiSsmPath,
        region: env.awsRegion,
      });

      const cmd = new GetParameterCommand({
        Name: env.awsAmiSsmPath,
      });
      const result = await this.ssm.send(cmd);
      const amiId = result.Parameter?.Value || null;

      logInfo("aws.ssm.get_parameter.response", {
        name: env.awsAmiSsmPath,
        hasValue: Boolean(amiId),
      });

      if (!amiId) {
        logWarn("aws.ssm.get_parameter.empty_value", {
          name: env.awsAmiSsmPath,
          fallbackAmiId: "ami-mock-ubuntu-24",
        });
      }

      return amiId || "ami-mock-ubuntu-24";
    } catch (err) {
      logError("aws.ssm.get_parameter.error", err, {
        name: env.awsAmiSsmPath,
      });
      return "ami-mock-ubuntu-24";
    }
  }

  async provisionInstance(orderId) {
    if (!this.enabled) {
      const mockResult = {
        instanceId: `i-mock-${orderId.substring(0, 8)}`,
        status: "running",
        publicIp: "203.0.113.42",
      };

      logInfo("aws.ec2.run_instances.mock", {
        orderId,
        instanceId: mockResult.instanceId,
        publicIp: mockResult.publicIp,
      });

      return mockResult;
    }

    try {
      const amiId = await this.getLatestUbuntuAmi();

      const request = {
        ImageId: amiId,
        InstanceType: env.awsInstanceType,
        MinCount: 1,
        MaxCount: 1,
        SecurityGroupIds: env.awsSecurityGroupId ? [env.awsSecurityGroupId] : [],
        SubnetId: env.awsSubnetId || undefined,
        TagSpecifications: [
          {
            ResourceType: "instance",
            Tags: [
              { Key: "Name", Value: `clawparty-${orderId}` },
              { Key: "OrderId", Value: orderId },
            ],
          },
        ],
      };

      logInfo("aws.ec2.run_instances.request", {
        orderId,
        imageId: amiId,
        instanceType: request.InstanceType,
        subnetId: request.SubnetId || null,
        securityGroupId: env.awsSecurityGroupId || null,
      });

      const cmd = new RunInstancesCommand(request);

      const result = await this.ec2.send(cmd);
      const instance = result.Instances?.[0];
      const provisionResult = {
        instanceId: instance?.InstanceId || null,
        status: instance?.State?.Name || "unknown",
        publicIp: instance?.PublicIpAddress || null,
      };

      if (!provisionResult.instanceId) {
        throw new Error("EC2 provisioning returned empty instanceId");
      }

      logInfo("aws.ec2.run_instances.response", {
        orderId,
        instanceId: provisionResult.instanceId,
        status: provisionResult.status,
        publicIp: provisionResult.publicIp,
      });

      return provisionResult;
    } catch (err) {
      logError("aws.ec2.run_instances.error", err, { orderId });
      throw err;
    }
  }

  async createDnsRecord(orderId, instanceIp) {
    if (!this.enabled) {
      const mockResult = {
        recordId: `mock-record-${orderId.substring(0, 8)}`,
        name: `${orderId.substring(0, 8)}.${env.awsDomainSuffix}`,
        status: "INSYNC",
      };

      logInfo("aws.route53.upsert_record.mock", {
        orderId,
        recordName: mockResult.name,
        value: instanceIp,
      });

      return mockResult;
    }

    try {
      const recordName = `${orderId.substring(0, 8)}.${env.awsDomainSuffix}`;
      const request = {
        HostedZoneId: env.awsHostedZoneId,
        ChangeBatch: {
          Changes: [
            {
              Action: "UPSERT",
              ResourceRecordSet: {
                Name: recordName,
                Type: "A",
                TTL: 300,
                ResourceRecords: [{ Value: instanceIp }],
              },
            },
          ],
        },
      };

      logInfo("aws.route53.upsert_record.request", {
        orderId,
        hostedZoneId: env.awsHostedZoneId,
        recordName,
        value: instanceIp,
      });

      const cmd = new ChangeResourceRecordSetsCommand(request);

      const result = await this.route53.send(cmd);
      const changeId = result.ChangeInfo?.Id || null;

      logInfo("aws.route53.upsert_record.response", {
        orderId,
        recordName,
        status: result.ChangeInfo?.Status || null,
        recordId: changeId,
      });

      if (!changeId) {
        throw new Error("Route53 UPSERT returned empty change id");
      }

      return {
        recordId: changeId,
        name: recordName,
        value: instanceIp,
        status: result.ChangeInfo?.Status || "PENDING",
      };
    } catch (err) {
      logError("aws.route53.upsert_record.error", err, {
        orderId,
        value: instanceIp,
      });
      throw err;
    }
  }

  async stopInstance(instanceId) {
    if (!instanceId) {
      logWarn("aws.ec2.stop_instance.skipped", {
        reason: "missing_instance_id",
      });
      return {
        stopped: true,
        status: "missing_instance_id",
      };
    }

    if (!this.enabled) {
      logInfo("aws.ec2.stop_instance.mock", {
        instanceId,
        status: "stopped",
      });
      return {
        stopped: true,
        status: "stopped",
      };
    }

    try {
      logInfo("aws.ec2.stop_instance.request", {
        instanceId,
      });

      const instanceCmd = new StopInstancesCommand({
        InstanceIds: [instanceId],
      });
      const instanceResult = await this.ec2.send(instanceCmd);
      const instanceState =
        instanceResult.StoppingInstances?.[0]?.CurrentState?.Name || "stopping";

      logInfo("aws.ec2.stop_instance.response", {
        instanceId,
        state: instanceState,
      });

      return {
        stopped: true,
        status: instanceState,
      };
    } catch (err) {
      if (this.isIgnorableStopError(err)) {
        logWarn("aws.ec2.stop_instance.ignored", {
          instanceId,
          code: String(err?.name || err?.Code || ""),
          message: String(err?.message || ""),
        });
        return {
          stopped: true,
          status: "already_stopped",
        };
      }

      logError("aws.ec2.stop_instance.error", err, { instanceId });
      throw err;
    }
  }

  async deleteDnsRecord(recordName, recordValue) {
    if (!recordName || !recordValue) {
      logWarn("aws.route53.delete_record.skipped", {
        reason: "missing_dns_record",
        recordName: recordName || null,
      });
      return {
        deleted: true,
        status: "missing_dns_record",
      };
    }

    if (!this.enabled) {
      logInfo("aws.route53.delete_record.mock", {
        recordName,
        value: recordValue,
      });
      return {
        deleted: true,
        status: "INSYNC",
      };
    }

    try {
      const request = {
        HostedZoneId: env.awsHostedZoneId,
        ChangeBatch: {
          Changes: [
            {
              Action: "DELETE",
              ResourceRecordSet: {
                Name: recordName,
                Type: "A",
                TTL: 300,
                ResourceRecords: [{ Value: recordValue }],
              },
            },
          ],
        },
      };

      logInfo("aws.route53.delete_record.request", {
        hostedZoneId: env.awsHostedZoneId,
        recordName,
        value: recordValue,
      });

      const cmd = new ChangeResourceRecordSetsCommand(request);

      const result = await this.route53.send(cmd);

      logInfo("aws.route53.delete_record.response", {
        recordName,
        status: result.ChangeInfo?.Status || null,
      });

      return {
        deleted: true,
        status: result.ChangeInfo?.Status || "PENDING",
      };
    } catch (err) {
      if (this.isIgnorableDnsDeleteError(err)) {
        logWarn("aws.route53.delete_record.ignored", {
          recordName,
          code: String(err?.name || err?.Code || ""),
          message: String(err?.message || ""),
        });
        return {
          deleted: true,
          status: "already_deleted",
        };
      }

      logError("aws.route53.delete_record.error", err, {
        recordName,
        value: recordValue,
      });
      throw err;
    }
  }

  async cleanupResources(orderId, instanceId, dnsRecordName, dnsRecordValue) {
    logInfo("aws.cleanup.start", {
      orderId,
      instanceId: instanceId || null,
      dnsRecordName: dnsRecordName || null,
    });

    const stopResult = await this.stopInstance(instanceId);
    const dnsResult = await this.deleteDnsRecord(dnsRecordName, dnsRecordValue);

    logInfo("aws.cleanup.result", {
      orderId,
      cleanedUp: stopResult.stopped && dnsResult.deleted,
      stopStatus: stopResult.status,
      dnsStatus: dnsResult.status,
    });

    return {
      orderId,
      cleanedUp: stopResult.stopped && dnsResult.deleted,
      stopResult,
      dnsResult,
    };
  }

  isIgnorableStopError(err) {
    const message = String(err?.message || "");
    const code = String(err?.name || err?.Code || "");
    return (
      code.includes("InvalidInstanceID.NotFound") ||
      code.includes("IncorrectInstanceState") ||
      message.includes("is not in a state from which it can be stopped")
    );
  }

  isIgnorableDnsDeleteError(err) {
    const message = String(err?.message || "");
    const code = String(err?.name || err?.Code || "");
    return (
      code.includes("InvalidChangeBatch") &&
      (message.includes("not found") ||
        message.includes("does not exist") ||
        message.includes("it was not found"))
    );
  }
}

module.exports = {
  AWSProvisioning,
};
