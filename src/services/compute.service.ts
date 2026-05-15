import {
  EC2Client,
  RunInstancesCommand,
  TerminateInstancesCommand,
  DescribeInstancesCommand,
  DescribeInstanceStatusCommand,
  AuthorizeSecurityGroupIngressCommand,
  GetConsoleOutputCommand,
  waitUntilInstanceRunning,
  type Instance,
} from "@aws-sdk/client-ec2";
import { PrismaClient } from "@prisma/client";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";

export interface ProvisionResult {
  instanceId: string;
  publicIp: string | null;
}

export class ComputeService {
  private ec2: EC2Client;

  constructor(private prisma: PrismaClient) {
    this.ec2 = new EC2Client({
      region: config.AWS_REGION,
      credentials: {
        accessKeyId: config.AWS_ACCESS_KEY_ID,
        secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
      },
    });
  }

  /**
   * Build the cloud-init user-data script that bootstraps the agent on a fresh EC2 instance.
   * Installs Python, clones the agent repo, configures .env, starts as a systemd service.
   */
  private buildUserData(agentToken: string, arcName: string): string {
    const script = `#!/bin/bash
set -euo pipefail
exec > /var/log/arcstack-agent-setup.log 2>&1

echo "=== ArcStack Agent Bootstrap ==="
echo "Arc: ${arcName}"
echo "Started: $(date)"

# Update and install dependencies
apt-get update -y
apt-get install -y python3 python3-pip python3-venv git

# Create agent user
useradd -m -s /bin/bash arcagent || true

# Clone agent repo
AGENT_DIR=/opt/arcstack-agent
git clone ${config.AGENT_REPO_URL} "$AGENT_DIR"
cd "$AGENT_DIR"

# Create virtual environment and install deps
python3 -m venv venv
./venv/bin/pip install --upgrade pip
./venv/bin/pip install -r requirements.txt

# Create workspace directory
mkdir -p /home/arcagent/workspace
chown -R arcagent:arcagent /home/arcagent/workspace

# Write agent configuration
cat > "$AGENT_DIR/.env" <<ENVEOF
AGENT_TOKEN=${agentToken}
WS_URL=${config.AGENT_WS_URL}
WORKSPACE_DIR=/home/arcagent/workspace
LOG_LEVEL=INFO
HEARTBEAT_INTERVAL=30
COMMAND_TIMEOUT=30
MAX_OUTPUT_SIZE=65536
ENVEOF

chown -R arcagent:arcagent "$AGENT_DIR"

# Create systemd service
cat > /etc/systemd/system/arcstack-agent.service <<SVCEOF
[Unit]
Description=ArcStack Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=arcagent
Group=arcagent
WorkingDirectory=$AGENT_DIR
ExecStart=$AGENT_DIR/venv/bin/python -m src.main
Restart=always
RestartSec=5
Environment=HOME=/home/arcagent

[Install]
WantedBy=multi-user.target
SVCEOF

# Enable and start the agent
systemctl daemon-reload
systemctl enable arcstack-agent
systemctl start arcstack-agent

echo "=== ArcStack Agent Bootstrap Complete ==="
echo "Finished: $(date)"
`;
    return Buffer.from(script).toString("base64");
  }

  /**
   * Launch a new EC2 instance for an Arc, install the agent, and return the instance details.
   */
  async provisionInstance(arcId: string, arcName: string, agentToken: string): Promise<ProvisionResult> {
    logger.info({ arcId, arcName }, "Provisioning EC2 instance");

    const userData = this.buildUserData(agentToken, arcName);

    const runCmd = new RunInstancesCommand({
      ImageId: config.AWS_AMI_ID,
      InstanceType: config.AWS_INSTANCE_TYPE as any,
      MinCount: 1,
      MaxCount: 1,
      KeyName: config.AWS_KEY_PAIR_NAME,
      SecurityGroupIds: [config.AWS_SECURITY_GROUP_ID],
      SubnetId: config.AWS_SUBNET_ID,
      UserData: userData,
      TagSpecifications: [
        {
          ResourceType: "instance",
          Tags: [
            { Key: "Name", Value: `arcstack-${arcName}` },
            { Key: "ArcId", Value: arcId },
            { Key: "ManagedBy", Value: "arcstack" },
          ],
        },
      ],
    });

    const result = await this.ec2.send(runCmd);
    const instance = result.Instances?.[0];

    if (!instance?.InstanceId) {
      throw new Error("Failed to launch EC2 instance — no InstanceId returned");
    }

    const instanceId = instance.InstanceId;
    logger.info({ arcId, instanceId }, "EC2 instance launched, waiting for running state");

    // Store instanceId immediately so we can track it even if waiting fails
    await this.prisma.arc.update({
      where: { id: arcId },
      data: { instanceId, instanceState: "pending" },
    });

    // Wait for the instance to be in running state (up to 5 minutes)
    try {
      await waitUntilInstanceRunning(
        { client: this.ec2, maxWaitTime: 300 },
        { InstanceIds: [instanceId] },
      );
    } catch (err) {
      logger.warn({ arcId, instanceId, err }, "Timed out waiting for instance to reach running state");
    }

    // Get the public IP
    const publicIp = await this.getInstancePublicIp(instanceId);

    // Update the arc with full instance details
    await this.prisma.arc.update({
      where: { id: arcId },
      data: {
        instanceId,
        instanceIp: publicIp,
        instanceState: "running",
      },
    });

    logger.info({ arcId, instanceId, publicIp }, "EC2 instance provisioned successfully");

    return { instanceId, publicIp };
  }

  /**
   * Terminate the EC2 instance backing an Arc.
   */
  async terminateInstance(arcId: string): Promise<void> {
    const arc = await this.prisma.arc.findUnique({ where: { id: arcId } });

    if (!arc?.instanceId) {
      logger.warn({ arcId }, "No instance to terminate");
      return;
    }

    logger.info({ arcId, instanceId: arc.instanceId }, "Terminating EC2 instance");

    try {
      await this.ec2.send(
        new TerminateInstancesCommand({
          InstanceIds: [arc.instanceId],
        }),
      );

      await this.prisma.arc.update({
        where: { id: arcId },
        data: { instanceState: "terminated", instanceIp: null },
      });

      logger.info({ arcId, instanceId: arc.instanceId }, "EC2 instance terminated");
    } catch (err) {
      logger.error({ arcId, instanceId: arc.instanceId, err }, "Failed to terminate EC2 instance");
      throw err;
    }
  }

  /**
   * Get the current public IP for a running instance.
   */
  async getInstancePublicIp(instanceId: string): Promise<string | null> {
    try {
      const result = await this.ec2.send(
        new DescribeInstancesCommand({ InstanceIds: [instanceId] }),
      );
      const instance = result.Reservations?.[0]?.Instances?.[0];
      return instance?.PublicIpAddress ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Get the current state of an EC2 instance.
   */
  async getInstanceState(instanceId: string): Promise<string | null> {
    try {
      const result = await this.ec2.send(
        new DescribeInstancesCommand({ InstanceIds: [instanceId] }),
      );
      const instance = result.Reservations?.[0]?.Instances?.[0];
      return instance?.State?.Name ?? null;
    } catch {
      return null;
    }
  }

  async ensureSshAccess(): Promise<void> {
    try {
      await this.ec2.send(
        new AuthorizeSecurityGroupIngressCommand({
          GroupId: config.AWS_SECURITY_GROUP_ID,
          IpPermissions: [
            {
              IpProtocol: "tcp",
              FromPort: 22,
              ToPort: 22,
              IpRanges: [{ CidrIp: "0.0.0.0/0", Description: "SSH access" }],
            },
          ],
        }),
      );
      logger.info("SSH ingress rule added to security group");
    } catch (err: any) {
      if (err.Code === "InvalidPermission.Duplicate") {
        logger.debug("SSH ingress rule already exists");
      } else {
        logger.warn({ err }, "Failed to add SSH ingress rule");
      }
    }
  }

  async getConsoleOutput(instanceId: string): Promise<string | null> {
    try {
      const result = await this.ec2.send(
        new GetConsoleOutputCommand({ InstanceId: instanceId }),
      );
      return result.Output ? Buffer.from(result.Output, "base64").toString("utf-8") : null;
    } catch {
      return null;
    }
  }

  /**
   * Sync the instance state from AWS into the database for all arcs with active instances.
   */
  async syncInstanceStates(): Promise<void> {
    const arcs = await this.prisma.arc.findMany({
      where: {
        instanceId: { not: null },
        instanceState: { notIn: ["terminated"] },
      },
    });

    if (arcs.length === 0) return;

    const instanceIds = arcs.map((a) => a.instanceId!);

    try {
      const result = await this.ec2.send(
        new DescribeInstancesCommand({ InstanceIds: instanceIds }),
      );

      const stateMap = new Map<string, { state: string; ip: string | null }>();
      for (const reservation of result.Reservations ?? []) {
        for (const instance of reservation.Instances ?? []) {
          if (instance.InstanceId && instance.State?.Name) {
            stateMap.set(instance.InstanceId, {
              state: instance.State.Name,
              ip: instance.PublicIpAddress ?? null,
            });
          }
        }
      }

      for (const arc of arcs) {
        const info = stateMap.get(arc.instanceId!);
        if (info && (info.state !== arc.instanceState || info.ip !== arc.instanceIp)) {
          await this.prisma.arc.update({
            where: { id: arc.id },
            data: { instanceState: info.state, instanceIp: info.ip },
          });
        }
      }
    } catch (err) {
      logger.error({ err }, "Failed to sync instance states from AWS");
    }
  }
}
