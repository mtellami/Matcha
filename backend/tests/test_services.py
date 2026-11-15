from io import BytesIO
from unittest.mock import MagicMock
from email.message import EmailMessage
import pytest
import mailer
import storage


@pytest.fixture
def s3(monkeypatch):
    fake=MagicMock()
    monkeypatch.setattr(storage,'client',lambda:fake)
    monkeypatch.setenv('S3_BUCKET','private-photos')
    return fake


def test_photo_lifecycle_uses_same_bucket_and_object_key(s3):
    storage.put_photo('image.jpg',b'jpeg bytes')
    s3.put_object.assert_called_once_with(Bucket='private-photos',Key='image.jpg',Body=b'jpeg bytes',ContentType='image/jpeg')
    body=BytesIO(b'jpeg bytes'); s3.get_object.return_value={'Body':body}
    assert storage.get_photo('image.jpg')==b'jpeg bytes'
    assert body.closed
    s3.get_object.assert_called_once_with(Bucket='private-photos',Key='image.jpg')
    storage.delete_photo('image.jpg')
    s3.delete_object.assert_called_once_with(Bucket='private-photos',Key='image.jpg')


def test_storage_failure_propagates(s3):
    s3.put_object.side_effect=OSError('unavailable')
    with pytest.raises(OSError):storage.put_photo('image.jpg',b'data')


@pytest.fixture
def smtp(monkeypatch):
    for key in ('SMTP_HOST','SMTP_PORT','SMTP_USERNAME','SMTP_PASSWORD','SMTP_SECURITY'):
        monkeypatch.delenv(key,raising=False)
    monkeypatch.setenv('SMTP_HOST','smtp.example.test')
    plain=MagicMock(); secure=MagicMock()
    monkeypatch.setattr(mailer.smtplib,'SMTP',plain)
    monkeypatch.setattr(mailer.smtplib,'SMTP_SSL',secure)
    return plain,secure


def test_real_smtp_upgrades_before_authentication(smtp,monkeypatch):
    plain,secure=smtp
    monkeypatch.setenv('SMTP_USERNAME','user');monkeypatch.setenv('SMTP_PASSWORD','secret')
    message=EmailMessage();mailer.send_message(message)
    plain.assert_called_once_with(host='smtp.example.test',port=587,timeout=15)
    conn=plain.return_value.__enter__.return_value
    assert [call[0] for call in conn.mock_calls]==['ehlo','starttls','ehlo','login','send_message']
    assert conn.starttls.call_args.kwargs['context'].check_hostname
    secure.assert_not_called()


def test_implicit_tls_uses_ssl_transport(smtp,monkeypatch):
    monkeypatch.setenv('SMTP_SECURITY','ssl')
    mailer.send_message(EmailMessage())
    plain,secure=smtp
    plain.assert_not_called()
    assert secure.call_args.kwargs['port']==465
    secure.return_value.__enter__.return_value.starttls.assert_not_called()


def test_mailpit_without_tls_or_auth(smtp,monkeypatch):
    monkeypatch.setenv('SMTP_SECURITY','none');monkeypatch.setenv('SMTP_PORT','1025')
    mailer.send_message(EmailMessage())
    conn=smtp[0].return_value.__enter__.return_value
    conn.starttls.assert_not_called();conn.login.assert_not_called();conn.send_message.assert_called_once()


@pytest.mark.parametrize('mode,user,password',[('invalid','',''),('none','user','secret'),('ssl','user','')])
def test_invalid_mail_configuration_fails_before_connecting(smtp,monkeypatch,mode,user,password):
    monkeypatch.setenv('SMTP_SECURITY',mode);monkeypatch.setenv('SMTP_USERNAME',user);monkeypatch.setenv('SMTP_PASSWORD',password)
    with pytest.raises(ValueError):mailer.send_message(EmailMessage())
    smtp[0].assert_not_called();smtp[1].assert_not_called()


def test_starttls_failure_does_not_fall_back(smtp,monkeypatch):
    monkeypatch.setenv('SMTP_USERNAME','user');monkeypatch.setenv('SMTP_PASSWORD','secret')
    conn=smtp[0].return_value.__enter__.return_value
    conn.starttls.side_effect=mailer.smtplib.SMTPException('TLS unavailable')
    with pytest.raises(mailer.smtplib.SMTPException):mailer.send_message(EmailMessage())
    conn.login.assert_not_called();conn.send_message.assert_not_called()
