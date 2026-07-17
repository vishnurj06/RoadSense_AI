import os
import io
import json
import boto3
from botocore.client import Config

S3_ENDPOINT_URL = os.getenv("S3_ENDPOINT_URL", "http://localhost:9000")
S3_ACCESS_KEY = os.getenv("S3_ACCESS_KEY", "minioadmin")
S3_SECRET_KEY = os.getenv("S3_SECRET_KEY", "minioadmin")
S3_BUCKET_NAME = os.getenv("S3_BUCKET_NAME", "roadsense")

# B3-9: Server-side encryption is only enabled in production.
# Local MinIO does not have a KMS configured, so sending
# ServerSideEncryption=AES256 raises a NotImplemented error there.
# Set ENVIRONMENT=production in your cloud deployment env to activate it.
IS_PRODUCTION = os.getenv("ENVIRONMENT", "").lower() == "production"

# Initialize the boto3 client connection to local MinIO/S3 service
s3_client = boto3.client(
    "s3",
    endpoint_url=S3_ENDPOINT_URL,
    aws_access_key_id=S3_ACCESS_KEY,
    aws_secret_access_key=S3_SECRET_KEY,
    config=Config(signature_version="s3v4"),
    region_name="us-east-1",  # Standard placeholder region required by boto3
)


def _build_extra_args(content_type: str) -> dict:
    """Return the ExtraArgs dict for S3 upload calls.

    In production (ENVIRONMENT=production) we request AES256 server-side
    encryption.  In local/dev mode (the default) we omit the encryption
    header because MinIO requires a KMS to honour it and raises
    NotImplemented otherwise.
    """
    args: dict = {"ContentType": content_type}
    if IS_PRODUCTION:
        args["ServerSideEncryption"] = "AES256"
    return args


def init_s3_bucket():
    """Verifies that the target bucket exists and sets a public read policy."""
    try:
        s3_client.head_bucket(Bucket=S3_BUCKET_NAME)
        print(f"S3 Bucket '{S3_BUCKET_NAME}' already exists.", flush=True)
    except Exception:
        try:
            print(f"Creating S3 Bucket '{S3_BUCKET_NAME}'...", flush=True)
            s3_client.create_bucket(Bucket=S3_BUCKET_NAME)

            # Set public-read policy so anyone (e.g. browser) can read uploaded files directly
            policy = {
                "Version": "2012-10-17",
                "Statement": [
                    {
                        "Sid": "PublicRead",
                        "Effect": "Allow",
                        "Principal": "*",
                        "Action": ["s3:GetObject"],
                        "Resource": [f"arn:aws:s3:::{S3_BUCKET_NAME}/*"],
                    }
                ],
            }
            s3_client.put_bucket_policy(
                Bucket=S3_BUCKET_NAME, Policy=json.dumps(policy)
            )
            print(
                f"S3 Bucket '{S3_BUCKET_NAME}' successfully created with public-read policy.",
                flush=True,
            )
        except Exception as e:
            print(f"Warning: Failed to initialize S3 bucket: {e}", flush=True)


def upload_image_to_s3(file_path: str, filename: str) -> str:
    """Uploads a local file to S3 and returns its public web URL."""
    # Determine Content-Type based on extension
    content_type = "image/jpeg"
    if filename.lower().endswith(".png"):
        content_type = "image/png"
    elif filename.lower().endswith(".gif"):
        content_type = "image/gif"
    elif filename.lower().endswith(".webp"):
        content_type = "image/webp"

    s3_client.upload_file(
        Filename=file_path,
        Bucket=S3_BUCKET_NAME,
        Key=filename,
        ExtraArgs=_build_extra_args(content_type),
    )
    # The direct S3 public access URL
    return f"{S3_ENDPOINT_URL}/{S3_BUCKET_NAME}/{filename}"


def upload_image_bytes_to_s3(contents: bytes, filename: str, content_type: str) -> str:
    """Uploads in-memory image bytes to S3 and returns its public web URL."""
    s3_client.upload_fileobj(
        Fileobj=io.BytesIO(contents),
        Bucket=S3_BUCKET_NAME,
        Key=filename,
        ExtraArgs=_build_extra_args(content_type),
    )
    return f"{S3_ENDPOINT_URL}/{S3_BUCKET_NAME}/{filename}"
