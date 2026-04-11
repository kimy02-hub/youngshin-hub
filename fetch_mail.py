#!/usr/bin/env python3
"""fetch_mail.py v6 - DMS Dashboard sync - robust version"""
import subprocess, json, os, sys, datetime

REPO   = os.path.expanduser('~/youngshin-hub')
EMAILS = os.path.join(REPO, 'emails.json')
TASKS  = os.path.join(REPO, 'tasks.json')

MAIL_JXA = """
var Mail = Application('Mail');
var acct = null, accounts = Mail.accounts();
for (var a=0;a<accounts.length;a++){
  if(accounts[a].name()==='DMS'){acct=accounts[a];break;}
}
if(!acct){'ERROR:Account not found';}
else{
  var mb=null, mbs=acct.mailboxes();
  for(var b=0;b<mbs.length;b++){
    if(mbs[b].name()==='Inbox'){mb=mbs[b];break;}
  }
  if(!mb){'ERROR:Mailbox not found';}
  else{
    var msgs=mb.messages(), rows=[];
    var cutoff = new Date('2026-03-01T00:00:00');
    var scanLimit = Math.min(msgs.length, 300);
    for(var i=0; i<scanLimit; i++){
      try{
        var m=msgs[i];
        if(!m.flaggedStatus()) continue;
        var date=m.dateReceived();
        if(date < cutoff) continue;
        var id=m.messageId()||'';
        var subj=(m.subject()||'').replace(/~|~/g,' ');
        var from=(m.sender()||'').replace(/~|~/g,' ');
        var cc='';
        try{cc=m.ccAddress()||'';}catch(e){}
        rows.push([id,subj,from,date.toString(),m.readStatus(),m.flaggedStatus(),cc].join('~|~'));
        if(rows.length>=30) break;
      }catch(e){ continue; }
    }
    rows.join('ROWSEP');
  }
}
"""

CHROME_JXA = """
var chrome = Application('Google Chrome');
var wins = chrome.windows();
var result = null;
for (var w=0; w<wins.length; w++){
  var tabs = wins[w].tabs();
  for (var t=0; t<tabs.length; t++){
    if (tabs[t].url().indexOf('youngshin-hub') > -1){
      result = tabs[t].execute({javascript: 'localStorage.getItem("dms_tasks_v3")'});
      break;
    }
  }
  if (result) break;
}
result || 'NOT_FOUND';
"""

def jxa(script_str, lang='JavaScript'):
    try:
        r = subprocess.run(
            ['osascript', '-l', lang, '-e', script_str],
            capture_output=True, text=True, timeout=30)
        if r.returncode != 0:
            print(f'  JXA error: {r.stderr.strip()[:100]}')
            return ''
        return r.stdout.strip()
    except subprocess.TimeoutExpired:
        print('  JXA timeout - skipping')
        return ''
    except Exception as e:
        print(f'  JXA exception: {e}')
        return ''

def jxa_file(path):
    try:
        r = subprocess.run(
            ['osascript', '-l', 'JavaScript', path],
            capture_output=True, text=True, timeout=30)
        if r.returncode != 0:
            print(f'  JXA file error: {r.stderr.strip()[:100]}')
            return ''
        return r.stdout.strip()
    except subprocess.TimeoutExpired:
        print('  JXA file timeout - skipping')
        return ''
    except Exception as e:
        print(f'  JXA file exception: {e}')
        return ''

def parse_emails(raw):
    if not raw: return []
    emails, seen = [], set()
    for row in raw.split('ROWSEP'):
        row = row.strip()
        if not row: continue
        p = row.split('~|~')
        if len(p) < 6: continue
        mid = p[0].strip()
        if mid in seen: continue
        seen.add(mid)
        emails.append({
            'id': mid,
            'subject': p[1].strip() or '(no subject)',
            'sender': p[2].strip(),
            'date': p[3].strip(),
            'read': p[4].strip().lower() == 'true',
            'flagged': p[5].strip().lower() == 'true',
            'cc': p[6].strip() if len(p) > 6 else ''
        })
    return emails

def read_tasks_from_chrome():
    try:
        jxa_path = '/tmp/read_chrome_tasks.js'
        with open(jxa_path, 'w') as f:
            f.write(CHROME_JXA)
        raw = jxa_file(jxa_path)
        if not raw or raw == 'NOT_FOUND' or raw == 'null':
            print('  Chrome: dashboard tab not open')
            return None
        tasks = json.loads(raw)
        print(f'  Chrome: read {len(tasks)} tasks from localStorage')
        return tasks
    except Exception as e:
        print(f'  Chrome tasks error: {e}')
        return None

def read_tasks_from_disk():
    try:
        with open(TASKS) as f:
            return json.load(f).get('tasks', [])
    except:
        return []

def write_tasks(tlist):
    data = {'tasks': tlist, 'saved_at': datetime.datetime.now().isoformat()}
    with open(TASKS, 'w') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

def write_emails(emails):
    data = {'fetched_at': datetime.datetime.now().isoformat(), 'emails': emails}
    with open(EMAILS, 'w') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f'  Wrote {len(emails)} emails')

def merge_tasks(chrome_tasks, disk_tasks):
    if not chrome_tasks: return disk_tasks
    if not disk_tasks: return chrome_tasks
    merged_map = {}
    def task_time(t):
        return t.get('updatedAt') or t.get('doneAt') or t.get('createdAt') or ''
    for t in disk_tasks:
        merged_map[t['id']] = t
    for t in chrome_tasks:
        tid = t['id']
        if tid not in merged_map:
            merged_map[tid] = t
        else:
            if task_time(t) >= task_time(merged_map[tid]):
                merged_map[tid] = t
    # Filter out deleted tasks
    merged = [t for t in merged_map.values() if not t.get('deleted', False)]
    merged.sort(key=lambda t: (
        t.get('done', False),
        not t.get('flagged', False),
        -(len(t.get('createdAt','')) and __import__('datetime').datetime.fromisoformat(
            t['createdAt'].replace('Z','+00:00')).timestamp() or 0)
    ))
    mobile_only = [t for t in disk_tasks if t['id'] not in {x['id'] for x in (chrome_tasks or [])}]
    if mobile_only:
        print(f'  Merged {len(mobile_only)} tasks from mobile/other devices')
    return merged

def git_push(files):
    try:
        # Save file contents before reset
        saved = {}
        for fp in files:
            with open(fp, 'rb') as f:
                saved[fp] = f.read()
        # Reset to origin to avoid conflicts
        subprocess.run(['git','-C',REPO,'fetch','origin'], capture_output=True, timeout=30)
        subprocess.run(['git','-C',REPO,'reset','--hard','origin/main'], capture_output=True, timeout=30)
        # Restore our new file contents after reset
        for fp, content in saved.items():
            with open(fp, 'wb') as f:
                f.write(content)
        # Add and commit
        for fp in files:
            subprocess.run(['git','-C',REPO,'add', os.path.relpath(fp,REPO)], check=True)
        ts = datetime.datetime.now().strftime('%Y-%m-%d %H:%M')
        res = subprocess.run(['git','-C',REPO,'commit','-m',f'Auto-update {ts}'],
                             capture_output=True, text=True)
        if 'nothing to commit' in res.stdout:
            print('  No changes to push'); return
        subprocess.run(['git','-C',REPO,'push','--set-upstream','origin','main'],
                       check=True, timeout=30)
        print('  Pushed to GitHub!')
    except subprocess.TimeoutExpired:
        print('  Git timeout - will retry next run')
    except subprocess.CalledProcessError as e:
        print(f'  Git error: {e}')



def process_delete_requests():
    """Check for pending delete requests and delete emails in Apple Mail."""
    import json, base64, urllib.request
    API = 'https://api.github.com/repos/kimy02-hub/youngshin-hub/contents/delete_pending.json'
    TOKEN = open(os.path.expanduser('~/.git-credentials')).read().split(':')[2].split('@')[0] if os.path.exists(os.path.expanduser('~/.git-credentials')) else ''
    try:
        req = urllib.request.Request(API, headers={'Authorization': 'Bearer ' + TOKEN})
        resp = urllib.request.urlopen(req, timeout=10)
        data = json.loads(resp.read())
        pending = json.loads(base64.b64decode(data['content']))
        sha = data['sha']
        if not pending:
            return
        print(f'  Deleting {len(pending)} emails in Apple Mail...')
        deleted = []
        for msg_id in pending:
            safe_id = msg_id.replace('"', '')
            script = f'''tell application "Mail"
    set theMessages to messages of inbox whose message id is "{safe_id}"
    if (count of theMessages) > 0 then
        delete item 1 of theMessages
    end if
end tell'''
            r = subprocess.run(['osascript', '-e', script], capture_output=True, timeout=15)
            if r.returncode == 0:
                deleted.append(msg_id)
                print(f'    Deleted: {safe_id[:50]}')
        remaining = [x for x in pending if x not in deleted]
        content = json.dumps(remaining)
        encoded = base64.b64encode(content.encode()).decode()
        payload = json.dumps({'message': 'delete processed', 'content': encoded, 'sha': sha}).encode()
        req2 = urllib.request.Request(API, data=payload, method='PUT',
            headers={'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json'})
        urllib.request.urlopen(req2, timeout=10)
    except Exception as e:
        if 'HTTP Error 404' not in str(e):
            print(f'  Delete check: {e}')

def process_unflag_requests():
    """Check for pending unflag requests and apply them in Apple Mail."""
    import subprocess, json, base64, urllib.request, urllib.error
    UNFLAG_FILE = os.path.join(REPO, 'unflag_pending.json')
    API = 'https://api.github.com/repos/kimy02-hub/youngshin-hub/contents/unflag_pending.json'
    TOKEN = open(os.path.expanduser('~/.git-credentials')).read().split(':')[2].split('@')[0] if os.path.exists(os.path.expanduser('~/.git-credentials')) else ''

    try:
        # Read pending unflag list from GitHub
        req = urllib.request.Request(API, headers={'Authorization': 'Bearer ' + TOKEN})
        resp = urllib.request.urlopen(req, timeout=10)
        data = json.loads(resp.read())
        pending = json.loads(base64.b64decode(data['content']))
        sha = data['sha']
        if not pending:
            return
        print(f'  Unflagging {len(pending)} emails in Apple Mail...')
        # Build AppleScript to unflag each message by ID
        unflagged = []
        for msg_id in pending:
            safe_id = msg_id.replace('"', '')
            script = f'''tell application "Mail"
    set theMessages to messages of inbox whose message id is "{safe_id}"
    if (count of theMessages) > 0 then
        set flagged status of item 1 of theMessages to false
    end if
end tell'''
            r = subprocess.run(['osascript', '-e', script], capture_output=True, timeout=15)
            if r.returncode == 0:
                unflagged.append(msg_id)
                print(f'    Unflagged: {safe_id[:50]}')
        # Clear processed items from pending list
        remaining = [x for x in pending if x not in unflagged]
        # Push updated list back to GitHub
        content = json.dumps(remaining)
        encoded = base64.b64encode(content.encode()).decode()
        payload = json.dumps({'message': 'unflag processed', 'content': encoded, 'sha': sha}).encode()
        req2 = urllib.request.Request(API, data=payload, method='PUT',
            headers={'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json'})
        urllib.request.urlopen(req2, timeout=10)
    except Exception as e:
        if 'HTTP Error 404' not in str(e):
            print(f'  Unflag check: {e}')


def process_unflag_requests():
    """Check for pending unflag requests and apply them in Apple Mail."""
    import subprocess, json, base64, urllib.request, urllib.error
    UNFLAG_FILE = os.path.join(REPO, 'unflag_pending.json')
    API = 'https://api.github.com/repos/kimy02-hub/youngshin-hub/contents/unflag_pending.json'
    TOKEN = open(os.path.expanduser('~/.git-credentials')).read().split(':')[2].split('@')[0] if os.path.exists(os.path.expanduser('~/.git-credentials')) else ''

    try:
        # Read pending unflag list from GitHub
        req = urllib.request.Request(API, headers={'Authorization': 'Bearer ' + TOKEN})
        resp = urllib.request.urlopen(req, timeout=10)
        data = json.loads(resp.read())
        pending = json.loads(base64.b64decode(data['content']))
        sha = data['sha']
        if not pending:
            return
        print(f'  Unflagging {len(pending)} emails in Apple Mail...')
        # Build AppleScript to unflag each message by ID
        unflagged = []
        for msg_id in pending:
            safe_id = msg_id.replace('"', '')
            script = f'''tell application "Mail"
    set theMessages to messages of inbox whose message id is "{safe_id}"
    if (count of theMessages) > 0 then
        set flagged status of item 1 of theMessages to false
    end if
end tell'''
            r = subprocess.run(['osascript', '-e', script], capture_output=True, timeout=15)
            if r.returncode == 0:
                unflagged.append(msg_id)
                print(f'    Unflagged: {safe_id[:50]}')
        # Clear processed items from pending list
        remaining = [x for x in pending if x not in unflagged]
        # Push updated list back to GitHub
        content = json.dumps(remaining)
        encoded = base64.b64encode(content.encode()).decode()
        payload = json.dumps({'message': 'unflag processed', 'content': encoded, 'sha': sha}).encode()
        req2 = urllib.request.Request(API, data=payload, method='PUT',
            headers={'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json'})
        urllib.request.urlopen(req2, timeout=10)
    except Exception as e:
        if 'HTTP Error 404' not in str(e):
            print(f'  Unflag check: {e}')

def main():
    now = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    print(f'[{now}] Starting sync...')

    # 1. Fetch flagged emails from Apple Mail
    print('Fetching emails from Apple Mail...')
    raw = jxa(MAIL_JXA)
    if raw.startswith('ERROR:'):
        print(f'  Mail error: {raw}')
    else:
        emails = parse_emails(raw)
        write_emails(emails)  # Always write, even if empty - removes unflagged emails

    # 2. Sync tasks
    print('Syncing tasks from Chrome...')
    chrome_tasks = read_tasks_from_chrome()
    disk_tasks   = read_tasks_from_disk()
    merged       = merge_tasks(chrome_tasks, disk_tasks)
    write_tasks(merged)
    flagged_count = len([t for t in merged if t.get('flagged') and not t.get('done')])
    done_count    = len([t for t in merged if t.get('done')])
    print(f'  Tasks: {len(merged)} total ({flagged_count} flagged, {done_count} done)')

    # 2b. Process unflag requests
    process_unflag_requests()

    # 2b. Process unflag requests
    process_unflag_requests()

    # 2c. Process delete requests
    process_delete_requests()

    # 3. Push to GitHub
    print('Pushing to GitHub...')
    git_push([EMAILS])  # Tasks pushed by dashboard directly, not cron
    print('Done!')

if __name__ == '__main__':
    main()
