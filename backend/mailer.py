"""SMTP transport with explicit TLS mode and optional authentication."""
import os
import smtplib
import ssl


def send_message(message):
    mode = os.getenv('SMTP_SECURITY', 'starttls').lower()
    if mode not in ('none', 'starttls', 'ssl'):
        raise ValueError('SMTP_SECURITY must be none, starttls, or ssl')
    username = os.getenv('SMTP_USERNAME', '')
    password = os.getenv('SMTP_PASSWORD', '')
    if bool(username) != bool(password):
        raise ValueError('SMTP_USERNAME and SMTP_PASSWORD must be configured together')
    if username and mode == 'none':
        raise ValueError('SMTP authentication requires TLS')
    host = os.environ['SMTP_HOST']
    port = int(os.getenv('SMTP_PORT', '465' if mode == 'ssl' else '587'))
    context = ssl.create_default_context()
    options = {'host': host, 'port': port, 'timeout': 15}
    factory = smtplib.SMTP_SSL if mode == 'ssl' else smtplib.SMTP
    if mode == 'ssl':
        options['context'] = context
    with factory(**options) as smtp:
        if mode == 'starttls':
            smtp.ehlo()
            smtp.starttls(context=context)
            smtp.ehlo()
        if username:
            smtp.login(username, password)
        smtp.send_message(message)
