import { Global, Injectable, Logger, Module } from "@nestjs/common";
import nodemailer, { Transporter } from "nodemailer";
import { config } from "../config";

export interface MailAttachment {
  filename: string;
  content: string;
  contentType?: string;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  attachments?: MailAttachment[];
}

/** Sends via SMTP when SMTP_URL is set; otherwise logs the message (development). */
@Injectable()
export class MailService {
  private readonly logger = new Logger("Mail");
  private readonly transport: Transporter | null = config.smtpUrl
    ? nodemailer.createTransport(config.smtpUrl)
    : null;

  get configured(): boolean {
    return this.transport !== null;
  }

  async send(message: MailMessage): Promise<void> {
    if (!this.transport) {
      const attached = message.attachments?.length
        ? `\nAttachments: ${message.attachments.map((a) => a.filename).join(", ")}`
        : "";
      this.logger.log(
        `\n--- email (SMTP not configured) ---\nTo: ${message.to}\nSubject: ${message.subject}${attached}\n\n${message.text}\n---`,
      );
      return;
    }
    await this.transport.sendMail({
      from: config.mailFrom,
      to: message.to,
      subject: message.subject,
      text: message.text,
      attachments: message.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      })),
    });
  }
}

@Global()
@Module({ providers: [MailService], exports: [MailService] })
export class MailModule {}
