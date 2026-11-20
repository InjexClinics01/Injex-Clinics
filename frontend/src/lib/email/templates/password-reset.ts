/**
 * Password Reset Email Template for Injex Clinics.
 */

export interface PasswordResetEmailOptions {
  recipientName?: string;
  resetUrl: string;
}

export function generatePasswordResetEmail({ recipientName, resetUrl }: PasswordResetEmailOptions) {
  const greeting = recipientName ? `Hello ${recipientName},` : "Hello,";
  const subject = "Reset your Injex Clinics password";

  const text = `${greeting}

We received a request to reset your password for your Injex Clinics Staff Portal account.

Click the link below to set a new password:
${resetUrl}

This link will expire in 1 hour.

If you did not request a password reset, you can safely ignore this email. Your account remains secure and your password will not be changed.

—
Injex Clinics Staff Portal
`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background-color: #f4f4f5;
      color: #18181b;
      -webkit-font-smoothing: antialiased;
    }
    .wrapper {
      width: 100%;
      background-color: #f4f4f5;
      padding: 40px 16px;
    }
    .card {
      max-width: 520px;
      margin: 0 auto;
      background-color: #ffffff;
      border-radius: 12px;
      padding: 36px 32px;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05);
      border: 1px solid #e4e4e7;
    }
    .logo-container {
      margin-bottom: 24px;
      text-align: center;
    }
    .badge {
      display: inline-block;
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: #0284c7;
      background-color: #e0f2fe;
      padding: 4px 12px;
      border-radius: 9999px;
    }
    h1 {
      font-size: 20px;
      font-weight: 700;
      color: #09090b;
      margin: 16px 0 8px;
      text-align: center;
    }
    p {
      font-size: 15px;
      line-height: 24px;
      color: #52525b;
      margin: 16px 0;
    }
    .button-container {
      text-align: center;
      margin: 32px 0;
    }
    .button {
      display: inline-block;
      background-color: #09090b;
      color: #ffffff !important;
      text-decoration: none;
      font-size: 15px;
      font-weight: 600;
      padding: 12px 28px;
      border-radius: 8px;
    }
    .note {
      font-size: 13px;
      line-height: 20px;
      color: #71717a;
      border-top: 1px solid #f4f4f5;
      padding-top: 20px;
      margin-top: 28px;
    }
    .url-fallback {
      font-size: 12px;
      color: #71717a;
      word-break: break-all;
      margin-top: 12px;
    }
    .footer {
      text-align: center;
      margin-top: 24px;
      font-size: 12px;
      color: #a1a1aa;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="card">
      <div class="logo-container">
        <span class="badge">Injex Clinics</span>
      </div>
      <h1>Password Reset Request</h1>
      <p>${greeting}</p>
      <p>We received a request to reset your password for the Injex Clinics Staff Portal. Click the button below to choose a new password:</p>
      <div class="button-container">
        <a href="${resetUrl}" class="button" target="_blank" rel="noopener noreferrer">Reset Password</a>
      </div>
      <p class="url-fallback">If the button above does not work, copy and paste this link into your browser:<br>
        <a href="${resetUrl}" style="color: #0284c7;">${resetUrl}</a>
      </p>
      <div class="note">
        <strong>Important:</strong> This link is only valid for 1 hour. If you did not request this password reset, you can safely ignore this email—your account will remain secure and your password will not change.
      </div>
    </div>
    <div class="footer">
      &copy; Injex Clinics · Staff Performance & Rewards Portal
    </div>
  </div>
</body>
</html>`;

  return { subject, html, text };
}
