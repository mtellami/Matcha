"""SMTP transport with explicit TLS mode and optional authentication."""

import os
import smtplib
import ssl


def send_message(message):
    mode = os.getenv("SMTP_SECURITY", "starttls").lower()
    if mode not in ("none", "starttls", "ssl"):
        raise ValueError("SMTP_SECURITY must be none, starttls, or ssl")
    username = os.getenv("SMTP_USERNAME", "")
    password = os.getenv("SMTP_PASSWORD", "")
    if bool(username) != bool(password):
        raise ValueError("SMTP_USERNAME and SMTP_PASSWORD must be configured together")
    if username and mode == "none":
        raise ValueError("SMTP authentication requires TLS")
    host = os.environ["SMTP_HOST"]
    port = int(os.getenv("SMTP_PORT", "465" if mode == "ssl" else "587"))
    context = ssl.create_default_context()
    options = {"host": host, "port": port, "timeout": 15}
    factory = smtplib.SMTP_SSL if mode == "ssl" else smtplib.SMTP
    if mode == "ssl":
        options["context"] = context
    with factory(**options) as smtp:
        if mode == "starttls":
            smtp.ehlo()
            smtp.starttls(context=context)
            smtp.ehlo()
        if username:
            smtp.login(username, password)
        smtp.send_message(message)


def account_message(recipient, kind, token, origin):
    from html import escape
    from email.message import EmailMessage

    subjects = {
        "verify": "Verify your Matcha account",
        "reset": "Reset your Matcha password",
        "email": "Confirm your new Matcha email",
    }
    if kind not in subjects:
        raise ValueError("Unknown account email purpose")
    copy = {
        "verify": (
            "Finish setting up your account",
            "Verify my email",
            "Confirm your email to finish creating your Matcha account.",
        ),
        "reset": (
            "A fresh start is one click away",
            "Choose a new password",
            "Use the button below to choose a new password for your Matcha account.",
        ),
        "email": (
            "Confirm your new address",
            "Confirm email address",
            "Confirm this address to finish updating your Matcha account.",
        ),
    }
    heading, button, intro = copy[kind]
    url = f"{origin.rstrip('/')}/#action={kind}&token={token}"
    safe_url = escape(url, quote=True)
    safe_heading = escape(heading)
    safe_intro = escape(intro)
    safe_button = escape(button)
    safe_subject = escape(subjects[kind])
    message = EmailMessage()
    message["From"] = os.getenv("MAIL_FROM", "hello@matcha.local")
    message["To"] = recipient
    message["Subject"] = subjects[kind]
    message.set_content(
        f"MATCHA — GOOD PEOPLE. REAL POSSIBILITIES.\n\n"
        f"{heading}\n\n{intro}\n\n{button}:\n{url}\n\n"
        "This link expires in one hour and can only be used once. "
        "If you did not request this, you can ignore this email."
    )
    message.add_alternative(
        f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
    <style>
      .mail-fallback:hover {{ text-decoration:underline !important; }}
    </style>
  </head>
  <body class="mail-bg" style="margin:0;padding:0;background:#fcf7fb;color:#2e232d;font-family:'DM Sans',Arial,Helvetica,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">{safe_subject} — {safe_intro}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" class="mail-bg" style="background:#fcf7fb;width:100%;">
      <tr><td align="center" style="padding:36px 16px;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" class="mail-card" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #e2d1df;border-radius:18px;overflow:hidden;">
          <tr><td class="mail-head" style="padding:26px 36px;background:#ffffff;border-bottom:1px solid #e2d1df;">
            <div class="mail-accent" style="font-size:28px;font-weight:800;letter-spacing:-1.5px;color:#883578;">matcha</div>
            <div class="mail-muted" style="margin-top:5px;font-size:12px;color:#715a6e;">A little curiosity. A real connection.</div>
          </td></tr>
          <tr><td style="padding:38px 36px 20px;">
            <div class="mail-accent" style="font-size:10px;font-weight:700;letter-spacing:2px;color:#883578;text-transform:uppercase;">GOOD PEOPLE. REAL POSSIBILITIES.</div>
            <h1 class="mail-text" style="margin:14px 0 12px;font-family:'Playfair Display',Georgia,serif;font-size:30px;line-height:1.25;font-weight:400;letter-spacing:-.4px;color:#2e232d;">{safe_heading}</h1>
            <p class="mail-muted" style="margin:0;font-size:15px;line-height:1.7;color:#715a6e;">{safe_intro}</p>
          </td></tr>
          <tr><td align="center" style="padding:18px 36px 28px;">
            <a href="{safe_url}" role="button" class="mail-button" style="display:inline-block;padding:14px 24px;border-radius:10px;background:#883578;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;line-height:1.2;">{safe_button}</a>
          </td></tr>
          <tr><td style="padding:0 36px 30px;">
            <p class="mail-muted" style="margin:0 0 10px;font-size:12px;line-height:1.7;color:#715a6e;">This link expires in one hour and can only be used once. If you did not request this, you can safely ignore this email.</p>
            <p class="mail-muted" style="margin:0;font-size:12px;line-height:1.7;color:#715a6e;">Button not working? Copy and paste this link into your browser:<br><a class="mail-fallback" href="{safe_url}" style="color:#762e68;word-break:break-all;text-decoration:underline;">{safe_url}</a></p>
          </td></tr>
          <tr><td class="mail-foot" style="padding:18px 36px;background:#f4eaf2;border-top:1px solid #e2d1df;">
            <p class="mail-muted" style="margin:0;font-size:11px;line-height:1.6;color:#715a6e;">Made for real connections. Take your time. Be yourself.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>""",
        subtype="html",
    )
    return message


def deliver_account_message(message):
    import logging

    try:
        send_message(message)
        return True
    except (smtplib.SMTPException, OSError, ValueError) as exc:
        # Avoid logging recipients, links, SMTP responses, or credentials.
        logging.getLogger(__name__).warning(
            "Account email delivery failed (%s)", type(exc).__name__
        )
        return False
