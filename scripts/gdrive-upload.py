#!/usr/bin/env python3
"""
Google Drive 上传脚本（支持断点续传）

首次使用需要 OAuth 授权：
  1. 去 https://console.cloud.google.com/apis/credentials 创建 OAuth Client ID（桌面应用）
  2. 下载 credentials.json 放到本脚本同目录
  3. 运行脚本，浏览器会弹出授权页面，授权后自动保存 token

用法:
  python3 scripts/gdrive-upload.py /tmp/octopus-migrate/
  python3 scripts/gdrive-upload.py /tmp/octopus-migrate/ --folder "Octopus迁移包"
"""

import os
import sys
import argparse
import mimetypes
from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

SCOPES = ["https://www.googleapis.com/auth/drive.file"]
SCRIPT_DIR = Path(__file__).parent
TOKEN_FILE = SCRIPT_DIR / "gdrive-token.json"
CREDS_FILE = SCRIPT_DIR / "credentials.json"

# 颜色
CYAN = "\033[0;36m"
GREEN = "\033[0;32m"
YELLOW = "\033[1;33m"
RED = "\033[0;31m"
NC = "\033[0m"


def get_credentials():
    """获取或刷新 OAuth 凭据"""
    creds = None

    if TOKEN_FILE.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN_FILE), SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            print(f"{CYAN}[INFO]{NC}  刷新 token...")
            creds.refresh(Request())
        else:
            if not CREDS_FILE.exists():
                print(f"{RED}[FAIL]{NC}  缺少 credentials.json")
                print()
                print("  请按以下步骤创建：")
                print("  1. 打开 https://console.cloud.google.com/apis/credentials")
                print("  2. 创建 OAuth 2.0 Client ID（应用类型选「桌面应用」）")
                print(f"  3. 下载 JSON 放到 {CREDS_FILE}")
                print()
                sys.exit(1)

            flow = InstalledAppFlow.from_client_secrets_file(str(CREDS_FILE), SCOPES)
            creds = flow.run_local_server(port=0)

        TOKEN_FILE.write_text(creds.to_json())
        print(f"{GREEN}[OK]{NC}    token 已保存")

    return creds


def get_or_create_folder(service, folder_name):
    """在 Drive 根目录下查找或创建文件夹"""
    query = (
        f"name='{folder_name}' and mimeType='application/vnd.google-apps.folder' "
        f"and 'root' in parents and trashed=false"
    )
    results = service.files().list(q=query, spaces="drive", fields="files(id, name)").execute()
    files = results.get("files", [])

    if files:
        folder_id = files[0]["id"]
        print(f"{GREEN}[OK]{NC}    使用已有文件夹: {folder_name} ({folder_id})")
        return folder_id

    metadata = {
        "name": folder_name,
        "mimeType": "application/vnd.google-apps.folder",
    }
    folder = service.files().create(body=metadata, fields="id").execute()
    folder_id = folder.get("id")
    print(f"{GREEN}[OK]{NC}    创建文件夹: {folder_name} ({folder_id})")
    return folder_id


def upload_file(service, file_path, folder_id):
    """上传单个文件（带进度显示，支持断点续传）"""
    file_path = Path(file_path)
    file_size = file_path.stat().st_size
    human_size = _human_size(file_size)

    mime_type, _ = mimetypes.guess_type(str(file_path))
    if mime_type is None:
        mime_type = "application/octet-stream"

    metadata = {"name": file_path.name, "parents": [folder_id]}

    # 使用 resumable upload，chunk 大小 10MB
    media = MediaFileUpload(
        str(file_path),
        mimetype=mime_type,
        resumable=True,
        chunksize=10 * 1024 * 1024,
    )

    request = service.files().create(body=metadata, media_body=media, fields="id,name,size")

    print(f"{CYAN}[UP]{NC}    {file_path.name} ({human_size})", end="", flush=True)

    response = None
    while response is None:
        status, response = request.next_chunk()
        if status:
            pct = int(status.progress() * 100)
            print(f"\r{CYAN}[UP]{NC}    {file_path.name} ({human_size}) ... {pct}%  ", end="", flush=True)

    print(f"\r{GREEN}[OK]{NC}    {file_path.name} ({human_size})              ")
    return response.get("id")


def _human_size(size):
    for unit in ["B", "KB", "MB", "GB"]:
        if size < 1024:
            return f"{size:.1f}{unit}"
        size /= 1024
    return f"{size:.1f}TB"


def main():
    parser = argparse.ArgumentParser(description="上传文件到 Google Drive")
    parser.add_argument("source", help="要上传的文件或目录")
    parser.add_argument("--folder", default="Octopus迁移包", help="Drive 目标文件夹名 (默认: Octopus迁移包)")
    args = parser.parse_args()

    source = Path(args.source)
    if not source.exists():
        print(f"{RED}[FAIL]{NC}  路径不存在: {source}")
        sys.exit(1)

    # 收集要上传的文件
    if source.is_file():
        files = [source]
    else:
        files = sorted(f for f in source.iterdir() if f.is_file())

    if not files:
        print(f"{YELLOW}[WARN]{NC}  没有找到要上传的文件")
        sys.exit(0)

    print()
    print(f"{CYAN}╔══════════════════════════════════════════════════╗{NC}")
    print(f"{CYAN}║   Google Drive 上传                              ║{NC}")
    print(f"{CYAN}╚══════════════════════════════════════════════════╝{NC}")
    print()

    total_size = sum(f.stat().st_size for f in files)
    print(f"{CYAN}[INFO]{NC}  {len(files)} 个文件, 总计 {_human_size(total_size)}")
    print(f"{CYAN}[INFO]{NC}  目标文件夹: {args.folder}")
    print()

    # 认证
    creds = get_credentials()
    service = build("drive", "v3", credentials=creds)

    # 创建文件夹
    folder_id = get_or_create_folder(service, args.folder)

    # 上传
    print()
    for f in files:
        upload_file(service, f, folder_id)

    print()
    print(f"{GREEN}═══════════════════════════════════════════════════{NC}")
    print(f"{GREEN}  全部上传完成！{NC}")
    print(f"{GREEN}═══════════════════════════════════════════════════{NC}")
    print()
    print(f"  Drive 文件夹: https://drive.google.com/drive/search?q={args.folder}")
    print()


if __name__ == "__main__":
    main()
