import os
import requests
from dotenv import load_dotenv
import sys

# .env を読み込む (メインプロセスと同じ挙動に合わせる)
load_dotenv()

token = os.getenv("GITHUB_TOKEN")
if not token:
    print("❌ GITHUB_TOKEN not found in .env")
    sys.exit(1)

print(f"Token length: {len(token)}")
print(f"Token starts with: {token[:4]}")

url = "https://api.github.com/user"
headers = {
    "Authorization": f"token {token}",
    "Accept": "application/vnd.github.v3+json",
    "User-Agent": "Brownie-Diagnostic-Script" # カスタムUser-Agent
}

print(f"Testing connectivity to {url}...")
try:
    # 複数回試行して接続の安定性を確認
    for i in range(3):
        response = requests.get(url, headers=headers, timeout=10)
        print(f"Attempt {i+1}: Status Code: {response.status_code}")
        if response.status_code == 200:
            print(f"✅ Success! Logged in as: {response.json().get('login')}")
        else:
            print(f"❌ Failed: {response.text}")
except Exception as e:
    print(f"❌ Critical Connection Error: {type(e).__name__}: {e}")
    import traceback
    traceback.print_exc()

# IPv6 vs IPv4 テスト
print("\nTesting IPv4 specifically...")
try:
    import socket
    # api.github.com の IP を解決
    ips = socket.getaddrinfo("api.github.com", 443)
    for ip in ips:
        family, _, _, _, sockaddr = ip
        fam_str = "IPv4" if family == socket.AF_INET else "IPv6"
        print(f"Resolved api.github.com to {sockaddr[0]} ({fam_str})")
except Exception as e:
    print(f"❌ DNS Resolution Error: {e}")
