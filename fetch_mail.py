#!/usr/bin/env python3
"""fetch_mail.py v4 - DMS Dashboard sync"""
import subprocess, json, os, sys, ssl
import datetime

REPO   = os.path.expanduser('~/youngshin-hub')
EMAILS = os.path.join(REPO, 'emails.json')
TASKS  = os.path.join(REPO, 'tasks.json')
CERT   = os.path.join(REPO, '.cert/cert.pem')
KEY    = os.path.join(REPO, '.cert/key.pem')
PORT   = 8765

JXA = """
var Mail = Application('Mail');
var acct = null;
var accounts = Mail.accounts();
for (var a=0;a<accounts.length;a++){
  if(accounts[a].name()==='DMS'){acct=accounts[a];break;}
}
if(!acct){'ERROR:Account not found';}
else{
  var mb=null,mbs=acct.mailboxes();
  for(var b=0;b<mbs.length;b++){if(mbs[b].name()==='Inbox'){mb=mbs[b];break;}}
  if(!mb){'ERROR:Mailbox not found';}
  else{
    var msgs=mb.messages(),count=Math.min(msgs.length,60),rows=[];
    for(var i=0;i<count;i++){
      var m=msgs[i];
      var id=m.messageId()||'';
      var subj=(m.subject()||'').replace(/~\|~/g,' ');
      var from=(m.sender()||'').replace(/~\|~/g,' ');
      var date=m.dateReceived().toString();
      var cc='';try{cc=m.ccAddress()||'';}catch(e){}
      var r=m.readStatus(),fl=m.flaggedStatus();
      rows.push([id,subj,from,date,r,fl,cc].join('~|~'));
    }
    rows.join('ROWSEP');
  }
}
"""

def jxa(s):
    r=subprocess.run(['osascript','-l','JavaScript','-e',s],capture_output=True,text=True)
    if r.returncode!=0: raise RuntimeError(r.stderr.strip())
    return r.stdout.strip()

def parse_emails(raw):
    emails,seen=[],set()
    for row in raw.split('ROWSEP'):
        row=row.strip()
        if not row: continue
        p=row.split('~|~')
        if len(p)<6: continue
        mid=p[0].strip()
        if mid in seen: continue
        seen.add(mid)
        emails.append({'id':mid,'subject':p[1].strip() or '(no subject)',
            'sender':p[2].strip(),'date':p[3].strip(),
            'read':p[4].strip().lower()=='true',
            'flagged':p[5].strip().lower()=='true',
            'cc':p[6].strip() if len(p)>6 else ''})
    def sk(e):
        try: dt=datetime.datetime.strptime(e['date'][:24],'%a %b %d %Y %H:%M:%S')
        except: dt=datetime.datetime.min
        return(e['read'],not e['flagged'],-dt.timestamp())
    emails.sort(key=sk)
    return emails

def read_tasks():
    try:
        with open(TASKS) as f: return json.load(f).get('tasks',[])
    except: return []

def write_tasks(tlist):
    with open(TASKS,'w') as f:
        json.dump({'tasks':tlist,'saved_at':datetime.datetime.now().isoformat()},f,indent=2,ensure_ascii=False)

def write_emails(emails):
    with open(EMAILS,'w') as f:
        json.dump({'fetched_at':datetime.datetime.now().isoformat(),'emails':emails},f,indent=2,ensure_ascii=False)
    print(f'Wrote {len(emails)} emails')

def git_push(files):
    try:
        for fp in files:
            subprocess.run(['git','-C',REPO,'add',os.path.relpath(fp,REPO)],check=True)
        res=subprocess.run(['git','-C',REPO,'commit','-m',
            f'Auto-update {datetime.datetime.now().strftime("%Y-%m-%d %H:%M")}'],
            capture_output=True,text=True)
        if 'nothing to commit' in res.stdout: print('No changes.'); return
        subprocess.run(['git','-C',REPO,'push','--set-upstream','origin','main'],check=True)
        print('Pushed!')
    except subprocess.CalledProcessError as e: print(f'Git error:{e}')

def fetch_and_push():
    print('Fetching emails...')
    raw=jxa(JXA)
    if raw.startswith('ERROR:'): print(raw); sys.exit(1)
    emails=parse_emails(raw)
    print(f'Found {len(emails)} emails')
    write_emails(emails)
    if not os.path.exists(TASKS): write_tasks([])
    git_push([EMAILS])

def run_server():
    from http.server import HTTPServer, BaseHTTPRequestHandler
    class H(BaseHTTPRequestHandler):
        def log_message(self,fmt,*a):
            ts=datetime.datetime.now().strftime('%H:%M:%S')
            if '/save-tasks' in (a[0] if a else ''): print(f'[{ts}] {a}',flush=True)
        def cors(self):
            self.send_header('Access-Control-Allow-Origin','*')
            self.send_header('Access-Control-Allow-Methods','POST,GET,OPTIONS')
            self.send_header('Access-Control-Allow-Headers','Content-Type')
        def do_OPTIONS(self): self.send_response(200);self.cors();self.end_headers()
        def do_GET(self):
            self.send_response(200);self.cors()
            self.send_header('Content-Type','application/json');self.end_headers()
            self.wfile.write(b'{"status":"ok","service":"DMS task sync"}')
        def do_POST(self):
            if self.path=='/save-tasks':
                try:
                    n=int(self.headers.get('Content-Length',0))
                    data=json.loads(self.rfile.read(n))
                    tlist=data.get('tasks',[])
                    write_tasks(tlist)
                    git_push([TASKS])
                    self.send_response(200);self.cors()
                    self.send_header('Content-Type','application/json');self.end_headers()
                    self.wfile.write(json.dumps({'ok':True,'count':len(tlist)}).encode())
                    ts=datetime.datetime.now().strftime('%H:%M:%S')
                    print(f'[{ts}] Saved {len(tlist)} tasks to GitHub',flush=True)
                except Exception as e: self.send_response(500);self.end_headers();self.wfile.write(str(e).encode())
            else: self.send_response(404);self.end_headers()
    server=HTTPServer(('127.0.0.1',PORT),H)
    ctx=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(CERT,KEY)
    server.socket=ctx.wrap_socket(server.socket,server_side=True)
    print(f'Task sync server on https://localhost:{PORT}',flush=True)
    server.serve_forever()

if __name__=='__main__':
    if '--serve' in sys.argv: run_server()
    else: fetch_and_push()
