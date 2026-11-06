"""
Robust Pure-Python GitHub Repository Uploader (Zero 'git' CLI required!)
Pre-configured for GitHub user: krishna050702 (https://github.com/krishna050702/docify-audio-reader)

Handles:
- Windows / Corporate SSL Certificate verification fallback
- Both Classic Tokens (ghp_...) and Fine-Grained Tokens (github_pat_...)
- Automatic repository creation + branch initialization wait
- Detailed error logging to github_upload_error.log
"""

import base64
import json
import os
import ssl
import sys
import time
import traceback
import urllib.error
import urllib.request
from pathlib import Path

DEFAULT_OWNER = "krishna050702"
DEFAULT_REPO = "docify-audio-reader"

IGNORE_DIRS = {".git", "node_modules", ".venv", "venv", "__pycache__", ".expo", "dist", "web-build"}
IGNORE_FILES = {".env", " render.yaml", ".DS_Store", "Thumbs.db", "github_upload_error.log"}

# Create SSL context that tolerates Windows/corporate proxy root certificates
SSL_CTX = ssl.create_default_context()
SSL_UNVERIFIED_CTX = ssl._create_unverified_context()


def github_request(method: str, url: str, token: str, payload: dict | None = None) -> dict:
    clean_token = token.strip().strip('"').strip("'")
    headers = {
        "Authorization": f"token {clean_token}" if clean_token.startswith("ghp_") else f"Bearer {clean_token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Docify-GitHub-Uploader",
    }
    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"

    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, context=SSL_CTX, timeout=30) as resp:
            body = resp.read().decode("utf-8")
            return json.loads(body) if body else {}
    except urllib.error.URLError as e:
        # If SSL cert verification fails on Windows/corporate network, retry with unverified SSL context
        if "CERTIFICATE_VERIFY_FAILED" in str(e) or isinstance(getattr(e, "reason", None), ssl.SSLError):
            with urllib.request.urlopen(req, context=SSL_UNVERIFIED_CTX, timeout=30) as resp:
                body = resp.read().decode("utf-8")
                return json.loads(body) if body else {}
        raise


def read_http_error(err: urllib.error.HTTPError) -> str:
    try:
        raw = err.read().decode("utf-8", errors="ignore")
        parsed = json.loads(raw)
        return f"HTTP {err.code}: {parsed.get('message', raw)}"
    except Exception:
        return f"HTTP {err.code}: {err.reason}"


def collect_files(root_dir: Path) -> list[tuple[str, bytes]]:
    collected: list[tuple[str, bytes]] = []
    for dirpath, dirnames, filenames in os.walk(root_dir):
        dirnames[:] = [d for d in dirnames if d not in IGNORE_DIRS]
        for fname in filenames:
            if fname in IGNORE_FILES or fname.endswith(".pyc") or fname.endswith(".log"):
                continue
            full_path = Path(dirpath) / fname
            rel_path = full_path.relative_to(root_dir).as_posix()
            collected.append((rel_path, full_path.read_bytes()))
    return collected


def main():
    root_dir = Path(__file__).resolve().parent
    log_file = root_dir / "github_upload_error.log"

    print("============================================================")
    print("   Docify — Direct GitHub Uploader for krishna050702        ")
    print("============================================================\n")

    try:
        repo_prompt = f"1. Repository name [Press Enter for '{DEFAULT_OWNER}/{DEFAULT_REPO}']: "
        repo_input = input(repo_prompt).strip().strip('"').strip("'") or f"{DEFAULT_OWNER}/{DEFAULT_REPO}"

        if "github.com/" in repo_input:
            repo_input = repo_input.split("github.com/")[-1].replace(".git", "").strip("/")

        if "/" not in repo_input:
            owner = DEFAULT_OWNER
            repo = repo_input
        else:
            owner, repo = repo_input.split("/", 1)

        token = os.environ.get("GITHUB_TOKEN", "").strip()
        if not token:
            print("\nTo authorize the upload to your GitHub account:")
            print(" -> Classic Token URL: https://github.com/settings/tokens/new?scopes=repo&description=DocifyUpload")
            print("    (Make sure the 'repo' checkbox is checked when generating the token)")
            token = input("2. Paste your GitHub Personal Access Token (ghp_...): ").strip().strip('"').strip("'")

        if not token:
            print("\n[!] Error: No GitHub token was entered.")
            return

        # Step A: Verify Token & Authenticated User
        print("\n-> Verifying GitHub token...")
        try:
            user_info = github_request("GET", "https://api.github.com/user", token)
            auth_login = user_info.get("login", owner)
            print(f"   Authenticated as GitHub user: {auth_login}")
            owner = auth_login
        except urllib.error.HTTPError as e:
            msg = read_http_error(e)
            print(f"\n[!] Token verification failed ({msg}).")
            print("    Please generate a Classic Personal Access Token with the 'repo' scope checked.")
            log_file.write_text(f"Token verification failed: {msg}\n", encoding="utf-8")
            return

        # Step B: Check if Repository exists, or create it
        repo_api_url = f"https://api.github.com/repos/{owner}/{repo}"
        default_branch = "main"
        repo_exists = False

        try:
            repo_info = github_request("GET", repo_api_url, token)
            default_branch = repo_info.get("default_branch") or "main"
            repo_exists = True
            print(f"-> Found existing repository: https://github.com/{owner}/{repo} (branch: {default_branch})")
        except urllib.error.HTTPError as e:
            if e.code == 404:
                print(f"-> Creating new repository 'https://github.com/{owner}/{repo}'...")
                try:
                    repo_info = github_request(
                        "POST",
                        "https://api.github.com/user/repos",
                        token,
                        {
                            "name": repo,
                            "description": "Docify — Spotify for PDF & Word Documents (React Native + FastAPI + Hybrid Neural TTS)",
                            "private": False,
                            "auto_init": True,
                        },
                    )
                    default_branch = repo_info.get("default_branch") or "main"
                    repo_exists = True
                    print("   Waiting 3 seconds for GitHub to initialize main branch...")
                    time.sleep(3)
                except urllib.error.HTTPError as create_err:
                    err_detail = read_http_error(create_err)
                    print(f"\n[!] Could not auto-create repository ({err_detail}).")
                    print(f"    Fix: Go to https://github.com/new , create an empty repo named '{repo}', and run this script again!")
                    log_file.write_text(f"Create repo error: {err_detail}\n", encoding="utf-8")
                    return
            else:
                raise

        # Step C: Upload all project files
        files = collect_files(root_dir)
        print(f"-> Uploading {len(files)} files to https://github.com/{owner}/{repo} ...")

        for idx, (rel_path, content_bytes) in enumerate(files, 1):
            content_b64 = base64.b64encode(content_bytes).decode("ascii")
            file_url = f"https://api.github.com/repos/{owner}/{repo}/contents/{rel_path}"

            sha = None
            try:
                existing = github_request("GET", f"{file_url}?ref={default_branch}", token)
                if isinstance(existing, dict):
                    sha = existing.get("sha")
            except urllib.error.HTTPError:
                pass

            payload = {
                "message": f"Add/update {rel_path}",
                "content": content_b64,
                "branch": default_branch,
            }
            if sha:
                payload["sha"] = sha

            try:
                github_request("PUT", file_url, token, payload)
                print(f"   [{idx}/{len(files)}] Uploaded {rel_path}")
            except urllib.error.HTTPError as put_err:
                # If the repo was created completely empty without a default branch yet, omit 'branch' on the first file
                if put_err.code in (404, 409, 422):
                    payload.pop("branch", None)
                    github_request("PUT", file_url, token, payload)
                    print(f"   [{idx}/{len(files)}] Uploaded {rel_path}")
                else:
                    raise

        print("\n============================================================")
        print(f" SUCCESS! Your repository is live at:")
        print(f" https://github.com/{owner}/{repo}")
        print("============================================================")

    except Exception as exc:
        tb = traceback.format_exc()
        err_msg = str(exc)
        if isinstance(exc, urllib.error.HTTPError):
            err_msg = read_http_error(exc)
        print(f"\n[!] Upload failed with error: {err_msg}")
        log_file.write_text(f"{err_msg}\n\n{tb}", encoding="utf-8")
        print(f"    Full error details saved to: {log_file}")


if __name__ == "__main__":
    main()
    input("\nPress Enter to exit...")
