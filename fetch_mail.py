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
        for fp in files:
            subprocess.run(['git','-C',REPO,'add', os.path.relpath(fp,REPO)], check=True)
        ts = datetime.datetime.now().strftime('%Y-%m-%d %H:%M')
        res = subprocess.run(['git','-C',REPO,'commit','-m',f'Auto-update {ts}'],
                             capture_output=True, text=True)
        if 'nothing to commit' in res.stdout:
            print('  No changes to push'); return
        subprocess.run(['git','-C',REPO,'pull','--rebase','origin','main'],
                       capture_output=True, timeout=30)
        subprocess.run(['git','-C',REPO,'push','--set-upstream','origin','main'],
                       check=True, timeout=30)
        print('  Pushed to GitHub!')
    except subprocess.TimeoutExpired:
        print('  Git timeout - will retry next run')
    except subprocess.CalledProcessError as e:
        print(f'  Git error: {e}')

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
        if emails:
            write_emails(emails)
        else:
            print('  No flagged emails found or Mail unavailable')

    # 2. Sync tasks
    print('Syncing tasks from Chrome...')
    chrome_tasks = read_tasks_from_chrome()
    disk_tasks   = read_tasks_from_disk()
    merged       = merge_tasks(chrome_tasks, disk_tasks)
    write_tasks(merged)
    flagged_count = len([t for t in merged if t.get('flagged') and not t.get('done')])
    done_count    = len([t for t in merged if t.get('done')])
    print(f'  Tasks: {len(merged)} total ({flagged_count} flagged, {done_count} done)')

    # 3. Push to GitHub
    print('Pushing to GitHub...')
    git_push([EMAILS])  # Tasks pushed by dashboard directly, not cron
    print('Done!')

if __name__ == '__main__':
    main()
