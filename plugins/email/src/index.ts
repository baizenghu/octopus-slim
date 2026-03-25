import { createTransport, type Transporter } from 'nodemailer';
import { existsSync, statSync } from 'fs';
import { basename } from 'path';
import { Type } from '@sinclair/typebox';

const MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024; // 25MB

interface PluginConfig {
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPass?: string;
  fromName?: string;
}

/**
 * Enterprise Email Plugin
 *
 * 注册 send_email 原生工具，通过 SMTP 直接发送邮件。
 * 入口函数必须是同步的（octopus 忽略 promise 返回值）。
 */
export default function enterpriseEmailPlugin(api: any) {
  const config: PluginConfig = api.pluginConfig || {};

  const smtpHost = config.smtpHost || 'smtp.qq.com';
  const smtpPort = config.smtpPort || 465;
  const smtpUser = config.smtpUser || '';
  const smtpPass = config.smtpPass || '';
  const fromName = config.fromName || 'Octopus AI';

  let transporter: Transporter | null = null;

  if (smtpUser && smtpPass) {
    transporter = createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: { user: smtpUser, pass: smtpPass },
    });
  }

  api.registerTool(() => ({
    name: 'send_email',
    label: '发送邮件',
    description:
      '发送电子邮件。可以给指定收件人发送邮件，支持纯文本、HTML 格式和文件附件。',
    parameters: Type.Object({
      to: Type.String({ description: '收件人邮箱地址，多个用逗号分隔' }),
      subject: Type.String({ description: '邮件主题' }),
      body: Type.String({ description: '邮件正文内容（纯文本）' }),
      html: Type.Optional(Type.String({ description: '邮件 HTML 内容（可选，优先于 body）' })),
      cc: Type.Optional(Type.String({ description: '抄送地址（可选）' })),
      attachments: Type.Optional(Type.String({ description: '附件文件路径，多个用逗号分隔（可选）' })),
    }),
    async execute(_toolCallId: string, params: any) {
      if (!transporter) {
        return {
          content: [{ type: 'text' as const, text: 'SMTP 未配置，请在 octopus.json plugins.entries.enterprise-email.config 中设置 smtpUser 和 smtpPass' }],
        };
      }

      const mailOptions: any = {
        from: `${fromName} <${smtpUser}>`,
        to: params.to,
        subject: params.subject,
        ...(params.html ? { html: params.html } : { text: params.body }),
        ...(params.cc ? { cc: params.cc } : {}),
      };

      // 处理附件
      if (params.attachments) {
        const paths = params.attachments.split(',').map((p: string) => p.trim()).filter(Boolean);
        const valid: Array<{ filename: string; path: string }> = [];
        const errors: string[] = [];

        for (const filePath of paths) {
          if (!existsSync(filePath)) {
            errors.push(`文件不存在: ${filePath}`);
            continue;
          }
          const stat = statSync(filePath);
          if (stat.size > MAX_ATTACHMENT_SIZE) {
            errors.push(`文件过大(>25MB): ${filePath}`);
            continue;
          }
          valid.push({ filename: basename(filePath), path: filePath });
        }

        if (errors.length > 0 && valid.length === 0) {
          return {
            content: [{ type: 'text' as const, text: `附件错误:\n${errors.join('\n')}` }],
          };
        }
        if (valid.length > 0) {
          mailOptions.attachments = valid;
        }
        if (errors.length > 0) {
          api.logger?.warn?.(`[enterprise-email] 部分附件跳过: ${errors.join('; ')}`);
        }
      }

      try {
        const info = await transporter.sendMail(mailOptions);
        const attachCount = mailOptions.attachments ? mailOptions.attachments.length : 0;
        return {
          content: [{
            type: 'text' as const,
            text: `邮件发送成功！\n收件人: ${params.to}\n主题: ${params.subject}\n附件: ${attachCount} 个\nMessage-ID: ${info.messageId}`,
          }],
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text' as const, text: `邮件发送失败: ${err.message}` }],
        };
      }
    },
  }));

  api.logger?.info?.('enterprise-email plugin registered');
}
