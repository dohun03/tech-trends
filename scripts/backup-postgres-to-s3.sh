#!/usr/bin/env bash

# PostgreSQL custom-format dump를 S3에 업로드하고 지정 기간보다 오래된 동일 prefix의 백업을 삭제한다.
# 필요 도구: pg_dump(PostgreSQL client), AWS CLI v2
# 예시: BACKUP_ENV_FILE=/opt/tech-trends/.env.back ./scripts/backup-postgres-to-s3.sh
set -euo pipefail

if [[ -n "${BACKUP_ENV_FILE:-}" ]]; then
  if [[ ! -r "$BACKUP_ENV_FILE" ]]; then
    echo "BACKUP_ENV_FILE을 읽을 수 없습니다: $BACKUP_ENV_FILE" >&2
    exit 1
  fi

  set -a
  # shellcheck disable=SC1090
  source "$BACKUP_ENV_FILE"
  set +a
fi

for command_name in aws pg_dump date; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "필수 명령을 찾을 수 없습니다: $command_name" >&2
    exit 1
  fi
done

: "${BACK_PRIVATE_IP:?BACK_PRIVATE_IP must be set}"
: "${DB_USERNAME:?DB_USERNAME must be set}"
: "${DB_PASSWORD:?DB_PASSWORD must be set}"
: "${DB_DATABASE:?DB_DATABASE must be set}"
: "${S3_BUCKET:?S3_BUCKET must be set}"

retention_days="${RETENTION_DAYS:-7}"
if ! [[ "$retention_days" =~ ^[1-9][0-9]*$ ]]; then
  echo "RETENTION_DAYS는 1 이상의 정수여야 합니다: $retention_days" >&2
  exit 1
fi

backup_dir="${BACKUP_DIR:-/var/backups/tech-trends}"
s3_prefix="${S3_PREFIX:-tech-trends/postgres}"
s3_prefix="${s3_prefix#/}"
s3_prefix="${s3_prefix%/}"

mkdir -p "$backup_dir"

timestamp="$(date -u +'%Y%m%dT%H%M%SZ')"
backup_file="$backup_dir/${DB_DATABASE}-${timestamp}.dump"
s3_key="$s3_prefix/${DB_DATABASE}-${timestamp}.dump"
cutoff="$(date -u -d "$retention_days days ago" +'%Y-%m-%dT%H:%M:%SZ')"

cleanup_local_backup() {
  rm -f "$backup_file"
}
trap cleanup_local_backup EXIT

export PGHOST="${PGHOST:-$BACK_PRIVATE_IP}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-$DB_USERNAME}"
export PGPASSWORD="${PGPASSWORD:-$DB_PASSWORD}"
export PGDATABASE="${PGDATABASE:-$DB_DATABASE}"

pg_dump --format=custom --compress=9 --no-owner --no-privileges --file="$backup_file"
aws s3 cp "$backup_file" "s3://$S3_BUCKET/$s3_key" --only-show-errors --no-progress

# AWS CLI의 기본 pagination을 이용해 prefix 내 모든 객체를 검사한다.
aws s3api list-objects-v2 \
  --bucket "$S3_BUCKET" \
  --prefix "$s3_prefix/" \
  --query "Contents[?LastModified<=\`$cutoff\`].Key" \
  --output text \
  --no-cli-pager | tr '\t' '\n' | while IFS= read -r expired_key; do
  [[ -z "$expired_key" || "$expired_key" == "None" ]] && continue
  aws s3api delete-object --bucket "$S3_BUCKET" --key "$expired_key" --no-cli-pager
done

echo "PostgreSQL 백업 완료: s3://$S3_BUCKET/$s3_key"
