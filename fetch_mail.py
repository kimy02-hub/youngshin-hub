#!/usr/bin/env python3
"""
fetch_mail.py — DMS Mailbox Dashboard Fetcher
Fetches emails from Apple Mail (DMS account) via JXA, exports emails.json,
then commits + pushes to GitHub so the dashboard stays live on GitHub Pages.

SETUP (one-time):
  1. pip3 install --break-system-packages pyobjc-framework-AppleScriptKit  (optional, not needed)
  2. Set GITHUB_REPO_PATH below to the local path of your GitHub Pages repo
  3. Make sure `git` is configured with push access (SSH or token)
  4. Run: python3 fetch_mail.py

CRON (auto-refresh every 15 min):
  Open Terminal and run: crontab -e
  Add this line (adjust path):
  */15 * * * * /usr/bin/python3 /path/to/fetch_mail.py >> /tmp/fetchmail.log 2>&1
"""

import subprocess
import json
import os
import sys
from datetime import datetime

# ─── CONFIG ──────────────────────────────────────────────────────────────────
GITHUB_REPO_PATH = "/Users/youngshinkim/youngshin-hub"   # ← CHANGE THIS
EMAILS_JSON_PATH = os.path.join(GITHUB_REPO_PATH, "emails.json")
MAX_EMAILS = 60
ACCOUNT_NAME = "DMS"
MAILBOX_NAME = "Inbox"
# ─────────────────────────────────────────────────────────────────────────────


JXA_SCRIPT = f"""
var Mail = Application('Mail');
var accounts = Mail.accounts();
var acct = null;
for (var a = 0; a < accounts.length; a++) {{
    if (accounts[a].name() === '{ACCOUNT_NAME}') {{ acct = accounts[a]; break; }}
}}
if (!acct) {{ 'ERROR:Account not found'; }}
else {{
    var mbs = acct.mailboxes();
    var mb = null;
    for (var b = 0; b < mbs.length; b++) {{
        if (mbs[b].name() === '{MAILBOX_NAME}') {{ mb = mbs[b]; break; }}
    }}
    if (!mb) {{ 'ERROR:Mailbox not found'; }}
    else {{
        var msgs = mb.messages();
        var count = Math.min(msgs.length, {MAX_EMAILS});
        var rows = [];
        for (var i = 0; i < count; i++) {{
            var m = msgs[i];
            var id   = m.messageId() || '';
            var subj = (m.subject() || '').replace(/~\\|~/g, ' ');
            var from = (m.sender() || '').replace(/~\\|~/g, ' ');
            var date = m.dateReceived().toString();
            var cc   = '';
            try {{ cc = (m.ccAddress() || '').replace(/~\\|~/g, ' '); }} catch(e) {{}}
            var isRead    = m.readStatus();
            var isFlagged = m.flaggedStatus();
            rows.push([id, subj, from, date, isRead, isFlagged, cc].join('~|~'));
        }}
        rows.join('ROWSEP');
    }}
}}
"""


def run_jxa(script):
    result = subprocess.run(
        ["osascript", "-l", "JavaScript", "-e", script],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        raise RuntimeError(f"JXA error: {result.stderr.strip()}")
    return result.stdout.strip()


def parse_emails(raw):
    emails = []
    seen_ids = set()
    rows = raw.split("ROWSEP")
    for row in rows:
        row = row.strip()
        if not row:
            continue
        parts = row.split("~|~")
        if len(parts) < 6:
            continue
        msg_id   = parts[0].strip()
        subject  = parts[1].strip()
        sender   = parts[2].strip()
        date_str = parts[3].strip()
        is_read  = parts[4].strip().lower() == "true"
        flagged  = parts[5].strip().lower() == "true"
        cc       = parts[6].strip() if len(parts) > 6 else ""

        # deduplicate by message-id
        if msg_id in seen_ids:
            continue
        seen_ids.add(msg_id)

        emails.append({
            "id":       msg_id,
            "subject":  subject or "(no subject)",
            "sender":   sender,
            "date":     date_str,
            "read":     is_read,
            "flagged":  flagged,
            "cc":       cc,
        })

    # Sort: unread first, then flagged, then chronological
    def sort_key(e):
        try:
            dt = datetime.strptime(e["date"][:24], "%a %b %d %Y %H:%M:%S")
        except Exception:
            dt = datetime.min
        return (e["read"], not e["flagged"], -dt.timestamp())

    emails.sort(key=sort_key)
    return emails


def write_json(emails, path):
    data = {
        "fetched_at": datetime.now().isoformat(),
        "emails": emails
    }
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f"✅ Wrote {len(emails)} emails to {path}")


def git_push(repo_path, json_path):
    try:
        rel = os.path.relpath(json_path, repo_path)
        subprocess.run(["git", "-C", repo_path, "add", rel], check=True)
        msg = f"📬 Auto-update emails {datetime.now().strftime('%Y-%m-%d %H:%M')}"
        result = subprocess.run(
            ["git", "-C", repo_path, "commit", "-m", msg],
            capture_output=True, text=True
        )
        if "nothing to commit" in result.stdout:
            print("ℹ️  No changes to push.")
            return
        subprocess.run(["git", "-C", repo_path, "push"], check=True)
        print("🚀 Pushed to GitHub!")
    except subprocess.CalledProcessError as e:
        print(f"⚠️  Git error: {e}")


def main():
    print(f"📬 Fetching emails from Apple Mail ({ACCOUNT_NAME} → {MAILBOX_NAME})...")
    raw = run_jxa(JXA_SCRIPT)

    if raw.startswith("ERROR:"):
        print(f"❌ {raw}")
        sys.exit(1)

    emails = parse_emails(raw)
    print(f"   Found {len(emails)} unique emails (unread first, then flagged)")

    write_json(emails, EMAILS_JSON_PATH)

    if os.path.isdir(os.path.join(GITHUB_REPO_PATH, ".git")):
        git_push(GITHUB_REPO_PATH, EMAILS_JSON_PATH)
    else:
        print(f"⚠️  {GITHUB_REPO_PATH} is not a git repo. Skipping push.")
        print(f"   emails.json is ready at: {EMAILS_JSON_PATH}")


if __name__ == "__main__":
    main()
