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
    from email.message import EmailMessage

    subjects = {
        "verify": "Verify your Matcha account",
        "reset": "Reset your Matcha password",
        "email": "Confirm your new Matcha email",
    }
    if kind not in subjects:
        raise ValueError("Unknown account email purpose")
    message = EmailMessage()
    message["From"] = os.getenv("MAIL_FROM", "hello@matcha.local")
    message["To"] = recipient
    message["Subject"] = subjects[kind]
    message.set_content(
        f"Open this link within one hour:\n{origin.rstrip('/')}/#action={kind}&token={token}\n\nIf you did not request this, you can ignore this email."
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
