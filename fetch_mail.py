#!/usr/bin/env python3
"""
fetch_mail.py v3 - DMS Mailbox Dashboard
  python3 fetch_mail.py          -> fetch emails, push to GitHub
  python3 fetch_mail.py --serve  -> run task sync server on :8765
"""
import subprocess, json, os, sys, datetime

GITHUB_REPO_PATH = os.path.expanduser('~/youngshin-hub')
EMAILS_JSON_PATH = os.path.join(GITHUB_REPO_PATH, 'emails.json')
TASKS_JSON_PATH  = os.path.join(GITHUB_REPO_PATH, 'tasks.json')
MAX_EMAILS   = 60
ACCOUNT_NAME = 'DMS'
MAILBOX_NAME = 'Inbox'
SERVER_PORT  = 8765

JXA = """
var Mail = Application('Mail');
var accounts = Mail.accounts();
var acct = null;
for (var a = 0; a < accounts.length; a++) {
  if (accounts[a].name() === 'DMS') { acct = accounts[a]; break; }
}
if (!acct) { 'ERROR:Account not found'; }
else {
  var mbs = acct.mailboxes();
  var mb = null;
  for (var b = 0; b < mbs.length; b++) {
    if (mbs[b].name() === 'Inbox') { mb = mbs[b]; break; }
  }
  if (!mb) { 'ERROR:Mailbox not found'; }
  else {
    var msgs = mb.messages();
    var count = Math.min(msgs.length, 60);
    var rows = [];
    for (var i = 0; i < count; i++) {
      var m = msgs[i];
      var id   = m.messageId() || '';
      var subj = (m.subject() || '').replace(/~|~/g, ' ');
      var from = (m.sender() || '').replace(/~|~/g, ' ');
      var date = m.dateReceived().toString();
      var cc = ''; try { cc = (m.ccAddress() || ''); } catch(e) {}
      var isRead = m.readStatus(); var isFlagged = m.flaggedStatus();
      rows.push([id,subj,from,date,isRead,isFlagged,cc].join('~|~'));
    }
    rows.join('ROWSEP');
  }
}
"""

def run_jxa(script):
    r = subprocess.run(['osascript','-l','JavaScript','-e',script], capture_output=True, text=True)
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
        emails.append({'id':mid,'subject':p[1].strip() or '(no subject)',
            'sender':p[2].strip(),'date':p[3].strip(),
            'read':p[4].strip().lower()=='true','flagged':p[5].strip().lower()=='true',
            'cc':p[6].strip() if len(p)>6 else ''})
    def sk(e):
        try: dt = datetime.datetime.strptime(e['date'][:24],'%a %b %d %Y %H:%M:%S')
        except: dt = datetime.datetime.min
        return (e['read'], not e['flagged'], -dt.timestamp())
    emails.sort(key=sk)
    return emails

def read_tasks():
    try:
        with open(TASKS_JSON_PATH) as f: return json.load(f).get('tasks',[])
    except: return []

def write_tasks(task_list):
    data = {'tasks':task_list,'saved_at':datetime.datetime.now().isoformat()}
    with open(TASKS_JSON_PATH,'w') as f: json.dump(data,f,indent=2,ensure_ascii=False)

def write_emails(emails):
    data = {'fetched_at':datetime.datetime.now().isoformat(),'emails':emails}
    with open(EMAILS_JSON_PATH,'w') as f: json.dump(data,f,indent=2,ensure_ascii=False)
    print(f'Wrote {len(emails)} emails to emails.json')

def git_push(files):
    try:
        for fp in files:
            rel = os.path.relpath(fp, GITHUB_REPO_PATH)
            subprocess.run(['git','-C',GITHUB_REPO_PATH,'add',rel],check=True)
        msg = f'Auto-update {datetime.datetime.now().strftime("%Y-%m-%d %H:%M")}'
        res = subprocess.run(['git','-C',GITHUB_REPO_PATH,'commit','-m',msg],capture_output=True,text=True)
        if 'nothing to commit' in res.stdout: print('No changes.'); return
        subprocess.run(['git','-C',GITHUB_REPO_PATH,'push','--set-upstream','origin','main'],check=True)
        print('Pushed to GitHub!')
    except subprocess.CalledProcessError as e: print(f'Git error: {e}')

def fetch_and_push():
    print(f'Fetching emails...')
    raw = run_jxa(JXA)
    if raw.startswith('ERROR:'): print(raw); sys.exit(1)
    emails = parse_emails(raw)
    print(f'Found {len(emails)} emails')
    write_emails(emails)
    if not os.path.exists(TASKS_JSON_PATH): write_tasks([])
    files = [EMAILS_JSON_PATH]
    if os.path.isdir(os.path.join(GITHUB_REPO_PATH,'.git')): git_push(files)

def run_server():
    from http.server import HTTPServer, BaseHTTPRequestHandler
    class H(BaseHTTPRequestHandler):
        def log_message(self,f,*a): pass
        def cors(self):
            self.send_header('Access-Control-Allow-Origin','*')
            self.send_header('Access-Control-Allow-Methods','POST,GET,OPTIONS')
            self.send_header('Access-Control-Allow-Headers','Content-Type')
        def do_OPTIONS(self):
            self.send_response(200); self.cors(); self.end_headers()
        def do_GET(self):
            self.send_response(200); self.cors()
            self.send_header('Content-Type','application/json'); self.end_headers()
            self.wfile.write(b'{"status":"ok"}')
        def do_POST(self):
            if self.path == '/save-tasks':
                try:
                    n = int(self.headers.get('Content-Length',0))
                    body = self.rfile.read(n)
                    data = json.loads(body)
                    tlist = data.get('tasks',[])
                    write_tasks(tlist)
                    git_push([TASKS_JSON_PATH])
                    self.send_response(200); self.cors()
                    self.send_header('Content-Type','application/json'); self.end_headers()
                    self.wfile.write(json.dumps({'ok':True,'count':len(tlist)}).encode())
                    ts = datetime.datetime.now().strftime('%H:%M:%S')
                    print(f'[{ts}] Saved {len(tlist)} tasks to GitHub', flush=True)
                except Exception as e:
                    self.send_response(500); self.end_headers()
                    self.wfile.write(str(e).encode())
            else: self.send_response(404); self.end_headers()
    print(f'Task sync server on http://localhost:{SERVER_PORT}', flush=True)
    HTTPServer(('127.0.0.1', SERVER_PORT), H).serve_forever()

if __name__ == '__main__':
    if '--serve' in sys.argv: run_server()
    else: fetch_and_push()
