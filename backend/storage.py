"""Private S3 object storage; the same API works with RustFS and hosted S3."""

import os
from functools import lru_cache


@lru_cache(maxsize=1)
def client():
    import boto3
    from botocore.config import Config

    # Unset credentials allow the standard AWS credential chain (e.g. IAM roles).
    return boto3.client(
        "s3",
        endpoint_url=os.getenv("S3_ENDPOINT_URL") or None,
        region_name=os.getenv("S3_REGION", "us-east-1"),
        aws_access_key_id=os.getenv("S3_ACCESS_KEY_ID") or None,
        aws_secret_access_key=os.getenv("S3_SECRET_ACCESS_KEY") or None,
        aws_session_token=os.getenv("S3_SESSION_TOKEN") or None,
        config=Config(
            signature_version="s3v4",
            s3={"addressing_style": os.getenv("S3_ADDRESSING_STYLE", "path")},
            connect_timeout=5,
            read_timeout=15,
            retries={"mode": "standard", "max_attempts": 3},
            request_checksum_calculation="when_required",
            response_checksum_validation="when_required",
        ),
    )


def bucket():
    return os.environ["S3_BUCKET"]


def put_photo(key, contents):
    put_object(key, contents, "image/jpeg")


def put_object(key, contents, content_type):
    client().put_object(
        Bucket=bucket(), Key=key, Body=contents, ContentType=content_type
    )


def get_photo(key):
    return get_object(key)


def get_object(key):
    response = client().get_object(Bucket=bucket(), Key=key)
    try:
        return response["Body"].read()
    finally:
        response["Body"].close()


def delete_photo(key):
    delete_object(key)


def delete_object(key):
    client().delete_object(Bucket=bucket(), Key=key)


def initialize():
    """Verify a preprovisioned bucket, or create it explicitly for local use."""
    from botocore.exceptions import ClientError

    try:
        client().head_bucket(Bucket=bucket())
    except ClientError as exc:
        if str(exc.response["Error"]["Code"]) not in (
            "404",
            "NoSuchBucket",
            "NotFound",
        ):
            raise
        if os.getenv("S3_CREATE_BUCKET", "false").lower() != "true":
            raise RuntimeError(
                "S3 bucket does not exist; provision it or enable S3_CREATE_BUCKET"
            ) from exc
        options = {"Bucket": bucket()}
        region = os.getenv("S3_REGION", "us-east-1")
        if region != "us-east-1":
            options["CreateBucketConfiguration"] = {"LocationConstraint": region}
        try:
            client().create_bucket(**options)
        except ClientError as race:
            if race.response["Error"]["Code"] != "BucketAlreadyOwnedByYou":
                raise
