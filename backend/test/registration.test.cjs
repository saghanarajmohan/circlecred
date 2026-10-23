const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const express = require('express');

const tempDir=mkdtempSync(join(tmpdir(),'circlecred-registration-'));
process.env.DATABASE_PATH=join(tempDir,'registration.sqlite');
const router=require('../dist/routes/apiRoutes').default;
const {getDatabase}=require('../dist/services/database');
const {verifyPassword}=require('../dist/services/auth');
const app=express();app.use(express.json());app.use('/api',router);
let server,base;
const json=body=>({headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const call=(path,cookie,options={})=>fetch(`${base}${path}`,{...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...options.headers}});
async function register(name,email,password='private-user-password-123'){
  const response=await call('/auth/register',null,{method:'POST',...json({name,email,password})});
  const data=await response.json();
  return {response,data,cookie:response.headers.getSetCookie()[0]?.split(';')[0]};
}

before(async()=>{await new Promise(resolve=>{server=app.listen(0,resolve)});base=`http://127.0.0.1:${server.address().port}/api`});
after(async()=>{await new Promise(resolve=>server.close(resolve));getDatabase().close();rmSync(tempDir,{recursive:true,force:true})});

test('public registration validates inputs, hashes the password, and starts a member session',async()=>{
  assert.equal((await call('/auth/register',null,{method:'POST',...json({name:'X',email:'bad',password:'short'})})).status,400);
  const created=await register('New User','NEW@example.test');
  assert.equal(created.response.status,201);assert.equal(created.data.user.role,'member');assert.ok(created.cookie);
  const stored=getDatabase().prepare('SELECT password_hash,email FROM users WHERE id=?').get(created.data.user.id);
  assert.equal(stored.email,'new@example.test');assert.notEqual(stored.password_hash,'private-user-password-123');assert.equal(verifyPassword('private-user-password-123',stored.password_hash),true);
  assert.equal((await call('/dashboard',created.cookie)).status,200);
  assert.equal((await register('Duplicate','new@example.test')).response.status,409);
  assert.equal((await call('/head/circles',created.cookie)).status,403);
});

test('registered users can create a circle and become its scoped Circle Head',async()=>{
  const owner=await register('New Head','head@example.test');
  const create=await call('/circles',owner.cookie,{method:'POST',...json({name:'Owner Circle',contributionAmount:1200,dueDay:18,frequency:'monthly',cycleCount:12})});
  assert.equal(create.status,201);const circle=await create.json();
  const me=await(await call('/auth/me',owner.cookie)).json();assert.equal(me.user.role,'circle_head');assert.deepEqual(me.managedCircleIds,[circle.id]);
  assert.equal((await call(`/head/circles/${circle.id}/dashboard`,owner.cookie)).status,200);
  const outsider=await register('Other Head','other@example.test');
  const otherCircle=await call('/circles',outsider.cookie,{method:'POST',...json({name:'Other Circle',contributionAmount:900,dueDay:12})});assert.equal(otherCircle.status,201);
  const foreign=await(await otherCircle.json()).id;
  assert.equal((await call(`/head/circles/${foreign}/members`,owner.cookie)).status,404);
  assert.equal((await call('/circles',null,{method:'POST',...json({name:'Unauthenticated',contributionAmount:1})})).status,401);
});

test('registered members redeem only their valid one-time invitation code',async()=>{
  const owner=await register('Inviting Head','inviter@example.test');
  const circle=await(await call('/circles',owner.cookie,{method:'POST',...json({name:'Invited Circle',contributionAmount:500,dueDay:10})})).json();
  const invitation=await call(`/head/circles/${circle.id}/invitations`,owner.cookie,{method:'POST',...json({name:'Invited Member',email:'invited@example.test'})});
  assert.equal(invitation.status,201);const invite=(await invitation.json()).activationKey;
  const member=await register('Wrong Member','wrong@example.test');
  assert.equal((await call('/auth/invitations/redeem',member.cookie,{method:'POST',...json({invitationCode:invite})})).status,400);
  const invited=await register('Invited Member','invited@example.test');
  assert.equal((await call('/auth/invitations/redeem',invited.cookie,{method:'POST',...json({invitationCode:'invalid-code'})})).status,400);
  const redeemed=await call('/auth/invitations/redeem',invited.cookie,{method:'POST',...json({invitationCode:invite})});
  assert.equal(redeemed.status,201);const membership=await redeemed.json();assert.equal(membership.membershipRequest.circle_id,circle.id);assert.equal(membership.membershipRequest.status,'pending');
  assert.equal((await call('/auth/invitations/redeem',invited.cookie,{method:'POST',...json({invitationCode:invite})})).status,400);
  const memberDash=await(await call('/dashboard',invited.cookie)).json();assert.ok(!memberDash.circles.some(row=>row.id===circle.id));
  const pending=await(await call(`/head/circles/${circle.id}/members`,owner.cookie)).json();assert.equal(pending.applications.length,1);
  assert.equal((await call(`/head/circles/${circle.id}/applications/${pending.applications[0].request_id}/decision`,owner.cookie,{method:'POST',...json({decision:'approved'})})).status,200);
  const approvedDash=await(await call('/dashboard',invited.cookie)).json();assert.ok(approvedDash.circles.some(row=>row.id===circle.id));
  assert.equal((await call(`/head/circles/${circle.id}/members`,invited.cookie)).status,403);
});
