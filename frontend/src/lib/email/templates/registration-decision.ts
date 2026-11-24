import { APP_NAME, categoryLabel } from "../../constants";

export interface RegistrationDecisionEmailOptions {
  recipientName: string;
  category?: string | null;
  loginUrl: string;
}

export function generateRegistrationApprovedEmail({ recipientName, category, loginUrl }: RegistrationDecisionEmailOptions) {
  const roleName = categoryLabel(category);
  const subject = `Welcome to ${APP_NAME} — Your account has been approved`;
  const greeting = recipientName ? `Hello ${recipientName},` : "Hello,";

  const text = `${greeting}

Great news! Your registration request for ${APP_NAME} (${roleName}) has been approved by the administrator.

You can now sign in to your staff portal with the password you created during signup:
${loginUrl}

Once signed in, you can track daily figures, monitor your goals, view team leaderboards, and earn reward points.

—
${APP_NAME} Team
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
      color: #0f766e;
      background-color: #ccfbf1;
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
      background-color: #0f766e;
      color: #ffffff !important;
      text-decoration: none;
      font-size: 15px;
      font-weight: 600;
      padding: 12px 28px;
      border-radius: 8px;
    }
    .footer {
      margin-top: 32px;
      padding-top: 20px;
      border-top: 1px solid #f4f4f5;
      font-size: 13px;
      color: #71717a;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="card">
      <div class="logo-container">
        <span class="badge">Account Approved</span>
      </div>
      <h1>Welcome to ${APP_NAME}</h1>
      <p>${greeting}</p>
      <p>Great news! Your registration request as a <strong>${roleName}</strong> has been approved by the administrator.</p>
      <p>You can now sign in using the email and password you created during signup.</p>
      <div class="button-container">
        <a href="${loginUrl}" class="button" target="_blank" rel="noopener noreferrer">Sign In to Staff Portal</a>
      </div>
      <div class="footer">
        &copy; ${new Date().getFullYear()} ${APP_NAME}. All rights reserved.
      </div>
    </div>
  </div>
</body>
</html>`;

  return { subject, html, text };
}

export interface RegistrationRejectedEmailOptions {
  recipientName: string;
  reason?: string | null;
}

export function generateRegistrationRejectedEmail({ recipientName, reason }: RegistrationRejectedEmailOptions) {
  const subject = `Update regarding your ${APP_NAME} registration request`;
  const greeting = recipientName ? `Hello ${recipientName},` : "Hello,";

  const text = `${greeting}

Thank you for your interest in joining ${APP_NAME}.

After review, an administrator was unable to approve your registration request at this time.${
    reason ? `\n\nReason: ${reason}` : ""
  }

If you believe this was a mistake or have any questions, please contact your clinic manager or clinic administration.

—
${APP_NAME} Team
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
      color: #991b1b;
      background-color: #fee2e2;
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
    .reason-box {
      background-color: #fef2f2;
      border-left: 4px solid #ef4444;
      padding: 12px 16px;
      margin: 20px 0;
      border-radius: 4px;
      font-size: 14px;
      color: #991b1b;
    }
    .footer {
      margin-top: 32px;
      padding-top: 20px;
      border-top: 1px solid #f4f4f5;
      font-size: 13px;
      color: #71717a;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="card">
      <div class="logo-container">
        <span class="badge">Registration Update</span>
      </div>
      <h1>Registration Request Update</h1>
      <p>${greeting}</p>
      <p>Thank you for submitting a registration request for the <strong>${APP_NAME}</strong> staff portal.</p>
      <p>After review, the administrator was unable to approve your registration request at this time.</p>
      ${reason ? `<div class="reason-box"><strong>Note from administrator:</strong><br>${reason}</div>` : ""}
      <p>If you have questions or believe this was done in error, please reach out directly to your clinic management.</p>
      <div class="footer">
        &copy; ${new Date().getFullYear()} ${APP_NAME}. All rights reserved.
      </div>
    </div>
  </div>
</body>
</html>`;

  return { subject, html, text };
}
