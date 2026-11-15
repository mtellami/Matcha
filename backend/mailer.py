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
        f"{heading}\n\n{intro}\n\n{button}:\n{url}\n\n"
        "This link expires in one hour and can only be used once. "
        "If you did not request this, you can ignore this email."
    )
    message.add_alternative(
        f"""<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
  <body style="margin:0;padding:0;background:#fafbf7;color:#243b30;font-family:Arial,Helvetica,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">{safe_subject} — {safe_intro}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#fafbf7;width:100%;">
      <tr><td align="center" style="padding:36px 16px;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #e3e8dd;border-radius:18px;overflow:hidden;">
          <tr><td style="padding:26px 36px;background:#ffffff;border-bottom:1px solid #e4e8df;">
            <div style="font-size:28px;font-weight:800;letter-spacing:-1.5px;color:#243b30;">matcha <span style="color:#9cba80;">✳</span></div>
            <div style="margin-top:5px;font-size:12px;color:#7d857a;">A little curiosity. A real connection.</div>
          </td></tr>
          <tr><td style="padding:38px 36px 20px;">
            <div style="font-size:10px;font-weight:700;letter-spacing:2px;color:#667e51;text-transform:uppercase;">GOOD PEOPLE. REAL POSSIBILITIES.</div>
            <h1 style="margin:14px 0 12px;font-family:Georgia,serif;font-size:30px;line-height:1.25;font-weight:400;letter-spacing:-.4px;color:#243b30;">{safe_heading}</h1>
            <p style="margin:0;font-size:15px;line-height:1.7;color:#68756a;">{safe_intro}</p>
          </td></tr>
          <tr><td align="center" style="padding:18px 36px 28px;">
            <a href="{safe_url}" role="button" style="display:inline-block;padding:14px 24px;border-radius:10px;background:#35553e;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;line-height:1.2;">{safe_button}</a>
          </td></tr>
          <tr><td style="padding:0 36px 30px;">
            <p style="margin:0;font-size:12px;line-height:1.7;color:#7d857a;">This link expires in one hour and can only be used once. If you did not request this, you can safely ignore this email.</p>
          </td></tr>
          <tr><td style="padding:18px 36px;background:#f3f6ee;border-top:1px solid #e4e8df;">
            <p style="margin:0;font-size:11px;line-height:1.6;color:#7d857a;">Made for real connections. Take your time. Be yourself.</p>
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
