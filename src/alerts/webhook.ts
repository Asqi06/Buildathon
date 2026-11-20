import type { WebhookAlert } from '../types.js';

export interface SlackBlockKitCard {
  text: string;
  blocks: Array<Record<string, unknown>>;
}

export interface DiscordEmbedCard {
  content?: string;
  embeds: Array<{
    title: string;
    description: string;
    color: number;
    fields: Array<{ name: string; value: string; inline?: boolean }>;
    footer?: { text: string };
    timestamp?: string;
  }>;
}

export class AlertManager {
  private alerts: WebhookAlert[] = [];
  private webhookUrl: string | null = null;

  constructor(webhookUrl?: string) {
    this.webhookUrl = webhookUrl ?? null;
  }

  setWebhookUrl(url: string | null): void {
    this.webhookUrl = url;
  }

  getWebhookUrl(): string | null {
    return this.webhookUrl;
  }

  getAlerts(): WebhookAlert[] {
    return [...this.alerts];
  }

  createDriftAlert(params: {
    endpoint: string;
    method: string;
    diffSummary: string;
    confidence: number;
    gatesPassed: string;
    blockedGate?: string;
    prUrl?: string | null;
    prBranch?: string | null;
    ruleKey?: string;
    severity?: 'warning' | 'critical' | 'info';
  }): WebhookAlert {
    const alert: WebhookAlert = {
      id: `alert_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      ts: new Date().toISOString(),
      severity: params.severity ?? (params.blockedGate ? 'critical' : 'warning'),
      title: params.blockedGate
        ? `[CRITICAL] Drift Blocked: Gate 5 Enforced on ${params.method} ${params.endpoint}`
        : `[HEALED] AutoPatch Healed Drift on ${params.method} ${params.endpoint}`,
      endpoint: params.endpoint,
      method: params.method,
      diffSummary: params.diffSummary,
      confidence: params.confidence,
      gatesPassed: params.gatesPassed,
      blockedGate: params.blockedGate,
      prUrl: params.prUrl ?? null,
      prBranch: params.prBranch ?? null,
      ruleKey: params.ruleKey,
      status: 'pending',
    };

    this.alerts.unshift(alert);
    if (this.alerts.length > 50) this.alerts.pop();

    // Trigger async webhook if configured
    if (this.webhookUrl) {
      this.dispatchWebhook(alert).catch((err) => {
        console.warn(`[autopatch:alerts] Webhook dispatch failed: ${String(err)}`);
      });
    }

    return alert;
  }

  approveAlert(alertId: string): WebhookAlert | null {
    const alert = this.alerts.find((a) => a.id === alertId);
    if (alert) {
      alert.status = 'approved';
      return alert;
    }
    return null;
  }

  dismissAlert(alertId: string): WebhookAlert | null {
    const alert = this.alerts.find((a) => a.id === alertId);
    if (alert) {
      alert.status = 'dismissed';
      return alert;
    }
    return null;
  }

  formatSlackPayload(alert: WebhookAlert): SlackBlockKitCard {
    const statusTag = alert.severity === 'critical' ? '[CRITICAL]' : '[OK]';
    return {
      text: `${statusTag} ${alert.title}`,
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: `${statusTag} AutoPatch Incident Alert` },
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Endpoint:*\n\`${alert.method} ${alert.endpoint}\`` },
            { type: 'mrkdwn', text: `*Confidence:*\n\`${Math.round(alert.confidence * 100)}%\`` },
          ],
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Gate Status:*\n${alert.gatesPassed}` },
            { type: 'mrkdwn', text: `*Field Diff:*\n\`${alert.diffSummary}\`` },
          ],
        },
        {
          type: 'actions',
          elements: [
            ...(alert.prUrl
              ? [
                  {
                    type: 'button',
                    text: { type: 'plain_text', text: 'View GitHub PR' },
                    url: alert.prUrl,
                    style: 'primary',
                  },
                ]
              : []),
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Force Approve Rule' },
              value: alert.id,
              action_id: 'force_approve_rule',
            },
          ],
        },
      ],
    };
  }

  formatDiscordPayload(alert: WebhookAlert): DiscordEmbedCard {
    const isCritical = alert.severity === 'critical';
    return {
      content: `**AutoPatch Alert Notification**`,
      embeds: [
        {
          title: alert.title,
          description: `Drift detected on \`${alert.method} ${alert.endpoint}\``,
          color: isCritical ? 0xef4444 : 0x10b981,
          fields: [
            { name: 'Field Diff', value: `\`${alert.diffSummary}\``, inline: false },
            { name: '5-Gate Status', value: alert.gatesPassed, inline: true },
            { name: 'Confidence', value: `${Math.round(alert.confidence * 100)}%`, inline: true },
            ...(alert.prUrl ? [{ name: 'GitHub PR', value: alert.prUrl, inline: false }] : []),
          ],
          footer: { text: 'AutoPatch Autonomous Self-Healing · Google Startup Buildathon' },
          timestamp: alert.ts,
        },
      ],
    };
  }

  private async dispatchWebhook(alert: WebhookAlert): Promise<void> {
    if (!this.webhookUrl) return;

    const isSlack = this.webhookUrl.includes('slack.com');
    const body = isSlack ? this.formatSlackPayload(alert) : this.formatDiscordPayload(alert);

    await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3000),
    });
  }
}
