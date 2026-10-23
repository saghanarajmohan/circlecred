const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const express = require('express');

const tempDir=mkdtempSync(join(tmpdir(),'circlecred-bootstrap-'));
process.env.DATABASE_PATH=join(tempDir,'empty.sqlite');
process.env.BOOTSTRAP_TOKEN='one-time-bootstrap-test-secret';
const router=require('../dist/routes/apiRoutes').default;
const {getDatabase}=require('../dist/services/database');
const {verifyPassword}=require('../dist/services/auth');
const app=express();app.use(express.json());app.use('/api',router);
let server,base;
const body=value=>({headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
const call=(path,options={})=>fetch(`${base}${path}`,options);

before(async()=>{await new Promise(resolve=>{server=app.listen(0,resolve)});base=`http://127.0.0.1:${server.address().port}/api`});
after(async()=>{await new Promise(resolve=>server.close(resolve));getDatabase().close();rmSync(tempDir,{recursive:true,force:true})});

test('fresh initialization has schema only and atomically bootstraps one private Circle Head',async()=>{
  const db=getDatabase();
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM users').get().count,0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM circles').get().count,0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM contributions').get().count,0);
  assert.equal((await(await call('/auth/bootstrap/status')).json()).available,true);
  const invalid=await call('/auth/bootstrap',{method:'POST',...body({name:'Admin',email:'admin@example.test',password:'short'})});assert.equal(invalid.status,400);
  const wrongToken=await call('/auth/bootstrap',{method:'POST',...body({name:'Admin',email:'admin@example.test',password:'private-password-123',bootstrapToken:'wrong'})});assert.equal(wrongToken.status,403);
  const requests=await Promise.all([
    call('/auth/bootstrap',{method:'POST',...body({name:'Initial Head',email:'initial@example.test',password:'private-password-123',bootstrapToken:process.env.BOOTSTRAP_TOKEN})}),
    call('/auth/bootstrap',{method:'POST',...body({name:'Second Head',email:'initial@example.test',password:'private-password-123',bootstrapToken:process.env.BOOTSTRAP_TOKEN})}),
  ]);
  assert.deepEqual(requests.map(response=>response.status).sort(),[201,409]);
  const winner=await requests.find(response=>response.status===201).json();
  assert.equal(winner.user.role,'circle_head');
  const stored=db.prepare('SELECT password_hash FROM users WHERE id=?').get(winner.user.id).password_hash;
  assert.notEqual(stored,'private-password-123');assert.equal(verifyPassword('private-password-123',stored),true);
  assert.equal((await call('/auth/bootstrap/status').then(response=>response.json())).available,false);
  assert.equal((await call('/auth/login',{method:'POST',...body({email:'head@circlecred.demo',password:'circlehead-demo'})})).status,401);
});

test('the bootstrapped head can create a circle and an invite expires and activates once',async()=>{
  const login=await call('/auth/login',{method:'POST',...body({email:'initial@example.test',password:'private-password-123'})});assert.equal(login.status,200);
  const cookie=login.headers.getSetCookie()[0].split(';')[0];
  const create=await call('/circles',{method:'POST',...body({name:'First Circle',contributionAmount:750,dueDay:18}),headers:{'Content-Type':'application/json',Cookie:cookie}});assert.equal(create.status,201);const circle=await create.json();assert.equal(circle.due_day,18);
  const invite=await call(`/head/circles/${circle.id}/invitations`,{method:'POST',...body({name:'New Member',email:'new@example.test'}),headers:{'Content-Type':'application/json',Cookie:cookie}});assert.equal(invite.status,201);const inviteJson=await invite.json();
  await call('/auth/logout',{method:'POST',headers:{Cookie:cookie}});
  const member=await call('/auth/register',{method:'POST',...body({name:'New Member',email:'new@example.test',password:'member-private-pass-123'})});assert.equal(member.status,201);const memberCookie=member.headers.getSetCookie()[0].split(';')[0];
  const db=getDatabase();db.prepare("UPDATE member_invites SET expires_at=? WHERE email='new@example.test'").run(new Date(Date.now()-1000).toISOString());
  assert.equal((await call('/auth/invitations/redeem',{method:'POST',...body({invitationCode:inviteJson.activationKey}),headers:{'Content-Type':'application/json',Cookie:memberCookie}})).status,400);
  assert.equal((await call('/auth/activate',{method:'POST',...body({token:inviteJson.activationKey,password:'member-private-pass-123'})})).status,410);
});
