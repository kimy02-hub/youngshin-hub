#!/usr/bin/env python3
"""
fetch_mail.py v5 - DMS Dashboard sync
Cron: */15 * * * * /usr/bin/python3 ~/youngshin-hub/fetch_mail.py >> /tmp/fetchmail.log 2>&1
"""
import subprocess, json, os, sys, datetime

REPO   = os.path.expanduser('~/youngshin-hub')
EMAILS = os.path.join(REPO, 'emails.json')
TASKS  = os.path.join(REPO, 'tasks.json')
DASHBOARD_URL = 'kimy02-hub.github.io/youngshin-hub'

# ?? JXA: fetch emails from Apple Mail ??????????????????????
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
    for(var i=0;i<msgs.length;i++){
      var m=msgs[i];
      if(!m.flaggedStatus()) continue;
      var date=m.dateReceived();
      if(date < cutoff) continue;
      var id=m.messageId()||'';
      var subj=(m.subject()||'').replace(/~|~/g,' ');
      var from=(m.sender()||'').replace(/~|~/g,' ');
      var cc='';try{cc=m.ccAddress()||'';}catch(e){}
      rows.push([id,subj,from,date.toString(),m.readStatus(),m.flaggedStatus(),cc].join('~|~'));
      if(rows.length>=100) break;
    }
    rows.join('ROWSEP');
  }
}
"""

# ?? JXA: read tasks from Chrome localStorage ???????????????
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
    r = subprocess.run(['osascript','-l',lang,'-e',script_str],
                       capture_output=True, text=True)
    if r.returncode != 0: raise RuntimeError(r.stderr.strip())
    return r.stdout.strip()

def jxa_file(path):
    r = subprocess.run(['osascript','-l','JavaScript', path],
                       capture_output=True, text=True)
    if r.returncode != 0: raise RuntimeError(r.stderr.strip())
    return r.stdout.strip()

def parse_emails(raw):
    emails, seen = [], set()
    for row in raw.split('ROWSEP'):
        row = row.strip()
        if not row: continue
        p = row.split('~|~')
        if len(p) < 6: continue
        mid = p[0].strip()
        if mid in seen: continue
        seen.add(mid)
        emails.append({'id':mid, 'subject':p[1].strip() or '(no subject)',
            'sender':p[2].strip(), 'date':p[3].strip(),
            'read':p[4].strip().lower()=='true',
            'flagged':p[5].strip().lower()=='true',
            'cc':p[6].strip() if len(p)>6 else ''})
    def sk(e):
        try: dt=datetime.datetime.strptime(e['date'][:24],'%a %b %d %Y %H:%M:%S')
        except: dt=datetime.datetime.min
        return (e['read'], not e['flagged'], -dt.timestamp())
    emails.sort(key=sk)
    return emails

def read_tasks_from_chrome():
    """Read tasks from Chrome localStorage. Returns list or None if Chrome not open."""
    try:
        # Write JXA to temp file to avoid quoting issues
        jxa_path = '/tmp/read_chrome_tasks.js'
        with open(jxa_path, 'w') as f:
            f.write(CHROME_JXA)
        raw = jxa_file(jxa_path)
        if raw == 'NOT_FOUND' or not raw or raw == 'null':
            print('  Chrome: dashboard tab not open, keeping existing tasks')
            return None
        tasks = json.loads(raw)
        print(f'  Chrome: read {len(tasks)} tasks from localStorage')
        return tasks
    except Exception as e:
        print(f'  Chrome tasks: {e}')
        return None

def read_tasks_from_disk():
    try:
        with open(TASKS) as f: return json.load(f).get('tasks', [])
    except: return []

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
    """Merge Chrome and disk tasks. Most recently modified wins."""
    if not chrome_tasks: return disk_tasks
    if not disk_tasks: return chrome_tasks
    # Build a map of all tasks by id, newer version wins
    merged_map = {}
    def task_time(t):
        # Use updatedAt if available, else createdAt
        ts = t.get('updatedAt') or t.get('doneAt') or t.get('createdAt') or ''
        return ts
    for t in disk_tasks:
        merged_map[t['id']] = t
    for t in chrome_tasks:
        tid = t['id']
        if tid not in merged_map:
            merged_map[tid] = t
        else:
            # Keep whichever was more recently modified
            if task_time(t) >= task_time(merged_map[tid]):
                merged_map[tid] = t
    merged = list(merged_map.values())
    # Sort: flagged+active first, then by createdAt desc
    merged.sort(key=lambda t: (t.get('done',False), not t.get('flagged',False), -(len(t.get('createdAt','')) and __import__('datetime').datetime.fromisoformat(t['createdAt'].replace('Z','+00:00')).timestamp() or 0)))
    disk_ids = {t['id'] for t in disk_tasks}
    chrome_ids = {t['id'] for t in chrome_tasks}
    mobile_only = [t for t in disk_tasks if t['id'] not in chrome_ids]
    if mobile_only:
        print(f'  Merged {len(mobile_only)} tasks from mobile/other devices')
    return merged

def git_push(files):
    try:
        for fp in files:
            subprocess.run(['git','-C',REPO,'add', os.path.relpath(fp,REPO)], check=True)
        ts  = datetime.datetime.now().strftime('%Y-%m-%d %H:%M')
        res = subprocess.run(['git','-C',REPO,'commit','-m',f'Auto-update {ts}'],
                             capture_output=True, text=True)
        if 'nothing to commit' in res.stdout:
            print('  No changes to push'); return
        subprocess.run(['git','-C',REPO,'push','--set-upstream','origin','main'], check=True)
        print('  Pushed to GitHub!')
    except subprocess.CalledProcessError as e:
        print(f'  Git error: {e}')

def main():
    now = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    print(f'[{now}] Starting sync...')

    # 1. Fetch emails
    print('Fetching emails from Apple Mail...')
    raw = jxa(MAIL_JXA)
    if raw.startswith('ERROR:'): print(raw); sys.exit(1)
    emails = parse_emails(raw)
    write_emails(emails)

    # 2. Sync tasks from Chrome (if dashboard is open)
    print('Syncing tasks from Chrome...')
    chrome_tasks = read_tasks_from_chrome()
    disk_tasks   = read_tasks_from_disk()
    merged       = merge_tasks(chrome_tasks, disk_tasks)
    write_tasks(merged)
    print(f'  Tasks: {len(merged)} total ({len([t for t in merged if t["flagged"] and not t["done"]])} flagged, {len([t for t in merged if t["done"]])} done)')

    # 3. Push both to GitHub
    print('Pushing to GitHub...')
    git_push([EMAILS, TASKS])
    print('Done!')

if __name__ == '__main__':
    main()
