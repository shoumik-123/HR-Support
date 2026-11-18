import { Global, Injectable, Logger, Module } from "@nestjs/common";
import nodemailer, { Transporter } from "nodemailer";
import { config } from "../config";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/** Sends via SMTP when SMTP_URL is set; otherwise logs the message (development). */
@Injectable()
export class MailService {
  private readonly logger = new Logger("Mail");
  private readonly transport: Transporter | null = config.smtpUrl
    ? nodemailer.createTransport(config.smtpUrl)
    : null;

  async send(message: MailMessage): Promise<void> {
    if (!this.transport) {
      this.logger.log(`\n--- email (SMTP not configured) ---\nTo: ${message.to}\nSubject: ${message.subject}\n\n${message.text}\n---`);
      return;
    }
    await this.transport.sendMail({ from: config.mailFrom, ...message });
  }
}

@Global()
@Module({ providers: [MailService], exports: [MailService] })
export class MailModule {}
