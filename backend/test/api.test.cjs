const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const express = require('express');
const { DatabaseSync } = require('node:sqlite');

const tempDir=mkdtempSync(join(tmpdir(),'circlecred-test-'));process.env.DATABASE_PATH=join(tempDir,'test.sqlite');process.env.CLIENT_URL='http://localhost:5173';
const legacy=new DatabaseSync(process.env.DATABASE_PATH);
legacy.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,phone TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE circles(id TEXT PRIMARY KEY,name TEXT NOT NULL,contribution_amount INTEGER NOT NULL,frequency TEXT NOT NULL DEFAULT 'monthly',cycle_count INTEGER NOT NULL DEFAULT 12,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE memberships(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,circle_id TEXT NOT NULL,joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,status TEXT NOT NULL DEFAULT 'active',UNIQUE(user_id,circle_id));
INSERT INTO users(id,name,email) VALUES('legacy-user','Legacy Member','legacy@example.test');
INSERT INTO circles(id,name,contribution_amount) VALUES('legacy-circle','Legacy Circle',500);
INSERT INTO memberships(id,user_id,circle_id) VALUES('legacy-membership','legacy-user','legacy-circle');`);legacy.close();
const router=require('../dist/routes/apiRoutes').default;const {getDatabase}=require('../dist/services/database');const {settlePayment}=require('../dist/services/payments');const {calculateReliabilityScore}=require('../dist/services/scoring');const {seedDemoData}=require('../dist/services/demoData');let startupSnapshot;
const app=express();app.use(express.json());app.use('/api',router);let server,base,memberCookie,headCookie,nishaCookie;
const json=body=>({headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const call=(path,cookie,options={})=>fetch(`${base}${path}`,{...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...options.headers}});
async function login(email,password){const response=await fetch(`${base}/auth/login`,{method:'POST',...json({email,password})});assert.equal(response.status,200);return response.headers.getSetCookie()[0].split(';')[0]}
before(async()=>{const db=getDatabase();startupSnapshot={users:db.prepare('SELECT COUNT(*) AS count FROM users').get().count,circles:db.prepare('SELECT COUNT(*) AS count FROM circles').get().count,demoCircle:db.prepare("SELECT COUNT(*) AS count FROM circles WHERE id='circle-women'").get().count};seedDemoData();await new Promise(resolve=>{server=app.listen(0,resolve)});base=`http://127.0.0.1:${server.address().port}/api`;memberCookie=await login('ananya@example.test','member-demo');nishaCookie=await login('nisha@example.test','member-demo');headCookie=await login('head@circlecred.demo','circlehead-demo')});
after(async()=>{await new Promise(resolve=>server.close(resolve));getDatabase().close();rmSync(tempDir,{recursive:true,force:true})});

test('normal API initialization creates schema without inserting demo business records',()=>{assert.deepEqual(startupSnapshot,{users:1,circles:1,demoCircle:0});assert.equal(getDatabase().prepare('PRAGMA user_version').get().user_version,2)});

test('auth, legacy migration, and role dashboards remain separated',async()=>{
  const db=getDatabase();const userColumns=db.prepare('PRAGMA table_info(users)').all().map(c=>c.name);assert.ok(userColumns.includes('role')&&userColumns.includes('password_hash'));
  assert.ok(db.prepare("SELECT id FROM memberships WHERE id='legacy-membership'").get());assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='contribution_rounds'").get());
  assert.equal(db.prepare("SELECT status FROM circles WHERE id='legacy-circle'").get().status,'frozen');
  assert.equal((await call('/dashboard')).status,401);assert.equal((await call('/dashboard',memberCookie)).status,200);assert.equal((await call('/head/circles',memberCookie)).status,403);assert.equal((await call('/dashboard',headCookie)).status,403);
  const profile=await(await call('/auth/me',headCookie)).json();assert.equal(profile.user.role,'circle_head');assert.deepEqual(profile.managedCircleIds,['circle-women']);
  assert.equal((await call('/head/circles/circle-community/dashboard?period=2026-10',headCookie)).status,404);
});

test('head collection totals use frozen eligible round records and expose only scoped member records',async()=>{
  const circles=await(await call('/head/circles',headCookie)).json();assert.deepEqual(circles.map(c=>c.id),['circle-women']);
  const response=await call('/head/circles/circle-women/dashboard?period=2026-10',headCookie);assert.equal(response.status,200);const dashboard=await response.json();
  assert.equal(dashboard.businessTimeZone,'Asia/Kolkata');assert.match(dashboard.businessDate,/^\d{4}-\d{2}-\d{2}$/);assert.equal(dashboard.summary.memberCount,3);assert.equal(dashboard.summary.expectedAmount,6000);assert.equal(dashboard.summary.collectedAmount,4000);assert.equal(dashboard.summary.outstandingAmount,2000);
  assert.equal(dashboard.payoutReadiness.available,6000);
  assert.equal(dashboard.summary.statusCounts.paid,2);assert.equal(dashboard.summary.statusCounts.overdue,1);assert.ok(dashboard.members.every(m=>!('email'in m)&&!('phone'in m)));
  assert.equal((await call('/head/circles/circle-women/dashboard?period=bad',headCookie)).status,400);
  const directory=await(await call('/head/circles/circle-women/members',headCookie)).json();assert.equal(directory.members.length,3);assert.ok(directory.members.every(m=>m.email));
  assert.equal((await call('/head/circles/circle-community/members',headCookie)).status,404);
  const failed=await(await call('/head/circles/circle-women/dashboard?period=2026-10&status=failed',headCookie)).json();assert.equal(failed.summary.memberCount,3);assert.equal(failed.members.length,1);assert.ok(failed.contributions.every(row=>row.status==='failed'));
});

test('activation keys create pending requests, heads decide membership, and freezing locks the initial roster',async()=>{
  const circleResponse=await call('/circles',headCookie,{method:'POST',...json({name:'Formation Test Circle',contributionAmount:1000,dueDay:15,memberLimit:3})});assert.equal(circleResponse.status,201);const circle=await circleResponse.json();assert.equal(circle.status,'open');assert.equal(circle.member_limit,3);
  assert.equal((await call(`/head/circles/${circle.id}/rounds`,headCookie,{method:'POST',...json({period:'2026-11',targetAmount:1000,deadline:'2026-11-15'})})).status,409);
  assert.equal((await call('/head/circles/circle-community/freeze',headCookie,{method:'POST'})).status,404);
  const makeInvite=async(name,email)=>{const response=await call(`/head/circles/${circle.id}/invitations`,headCookie,{method:'POST',...json({name,email})});assert.equal(response.status,201);const value=await response.json();assert.ok(value.activationKey);assert.equal('activationPath'in value,false);return value};
  const firstInvite=await makeInvite('Alpha Member','alpha@example.test');const pendingInvite=await makeInvite('Beta Member','beta@example.test');const afterFreezeInvite=await makeInvite('Gamma Member','gamma@example.test');const revokedInvite=await makeInvite('Revoked Member','revoked@example.test');assert.equal((await call(`/head/circles/${circle.id}/invitations/${revokedInvite.invitation.id}`,headCookie,{method:'PATCH',...json({status:'revoked'})})).status,200);assert.equal(getDatabase().prepare('SELECT status FROM member_invites WHERE id=?').get(revokedInvite.invitation.id).status,'revoked');
  assert.equal((await call(`/head/circles/${circle.id}/invitations`,headCookie,{method:'POST',...json({name:'Duplicate',email:'alpha@example.test'})})).status,409);
  const alpha=await call('/auth/register',null,{method:'POST',...json({name:'Alpha Member',email:'alpha@example.test',password:'private-alpha-password'} )});const alphaCookie=alpha.headers.getSetCookie()[0].split(';')[0];assert.equal(alpha.status,201);
  const beta=await call('/auth/register',null,{method:'POST',...json({name:'Beta Member',email:'beta@example.test',password:'private-beta-password'} )});const betaCookie=beta.headers.getSetCookie()[0].split(';')[0];assert.equal(beta.status,201);
  assert.equal((await call('/auth/invitations/redeem',alphaCookie,{method:'POST',...json({invitationCode:'x'.repeat(40)})})).status,400);
  const attacker=await call('/auth/register',null,{method:'POST',...json({name:'Key Guesser',email:'guesser@example.test',password:'private-guesser-password'})});const attackerCookie=attacker.headers.getSetCookie()[0].split(';')[0];for(let attempt=0;attempt<10;attempt++)assert.equal((await call('/auth/invitations/redeem',attackerCookie,{method:'POST',...json({invitationCode:String(attempt).padEnd(40,'x')})})).status,400);assert.equal((await call('/auth/invitations/redeem',attackerCookie,{method:'POST',...json({invitationCode:'last'.padEnd(40,'x')})})).status,429);
  const redeemed=await call('/auth/invitations/redeem',alphaCookie,{method:'POST',...json({invitationCode:firstInvite.activationKey})});assert.equal(redeemed.status,201);assert.equal((await redeemed.json()).membershipRequest.status,'pending');
  assert.equal((await call('/auth/invitations/redeem',alphaCookie,{method:'POST',...json({invitationCode:firstInvite.activationKey})})).status,400);
  assert.equal((await call('/dashboard',alphaCookie).then(async r=>(await r.json()).circles.some(c=>c.id===circle.id))),false);
  const alphaApplication=(await(await call(`/head/circles/${circle.id}/members`,headCookie)).json()).applications[0];assert.equal(alphaApplication.email,'alpha@example.test');
  assert.equal((await call(`/head/circles/${circle.id}/applications/${alphaApplication.request_id}/decision`,memberCookie,{method:'POST',...json({decision:'approved'})})).status,403);
  assert.equal((await call(`/head/circles/${circle.id}/applications/${alphaApplication.request_id}/decision`,headCookie,{method:'POST',...json({decision:'approved'})})).status,200);
  const circleStatus=(await(await call('/head/circles',headCookie)).json()).find(value=>value.id===circle.id);assert.equal(circleStatus.member_count,1);assert.equal(circleStatus.pending_count,0);assert.equal(circleStatus.remaining_capacity,2);
  assert.equal((await call('/dashboard',alphaCookie).then(async r=>(await r.json()).circles.some(c=>c.id===circle.id))),true);
  const alphaMember=getDatabase().prepare("SELECT id FROM memberships WHERE circle_id=? AND user_id=(SELECT id FROM users WHERE email='alpha@example.test')").get(circle.id).id;
  assert.equal((await call('/auth/invitations/redeem',betaCookie,{method:'POST',...json({invitationCode:pendingInvite.activationKey})})).status,201);
  const betaApplication=(await(await call(`/head/circles/${circle.id}/members`,headCookie)).json()).applications[0];
  const blockedFreeze=await call(`/head/circles/${circle.id}/freeze`,headCookie,{method:'POST'});assert.equal(blockedFreeze.status,409);assert.match((await blockedFreeze.json()).error,/pending application/);
  assert.equal(getDatabase().prepare("SELECT status FROM membership_requests WHERE id=?").get(betaApplication.request_id).status,'pending');
  assert.equal((await call(`/head/circles/${circle.id}/applications/${betaApplication.request_id}/decision`,headCookie,{method:'POST',...json({decision:'rejected'})})).status,200);
  assert.equal(getDatabase().prepare("SELECT COUNT(*) AS count FROM memberships WHERE circle_id=? AND user_id=(SELECT id FROM users WHERE email='beta@example.test')").get(circle.id).count,0);
  const frozen=await call(`/head/circles/${circle.id}/freeze`,headCookie,{method:'POST'});assert.equal(frozen.status,200);const frozenBody=await frozen.json();assert.equal(frozenBody.eligibleMembers,1);assert.equal(frozenBody.round.period,new Date().toISOString().slice(0,7));
  assert.equal(getDatabase().prepare('SELECT COUNT(*) AS count FROM round_members WHERE round_id=?').get(frozenBody.round.id).count,1);
  assert.equal((await call(`/head/circles/${circle.id}/invitations`,headCookie,{method:'POST',...json({name:'After Freeze',email:'after@example.test'})})).status,409);
  assert.equal((await call(`/head/circles/${circle.id}/members/${alphaMember}`,headCookie,{method:'PATCH',...json({status:'left'})})).status,409);
  const gamma=await call('/auth/register',null,{method:'POST',...json({name:'Gamma Member',email:'gamma@example.test',password:'private-gamma-password'} )});const gammaCookie=gamma.headers.getSetCookie()[0].split(';')[0];assert.equal((await call('/auth/invitations/redeem',gammaCookie,{method:'POST',...json({invitationCode:afterFreezeInvite.activationKey})})).status,400);
  const revoked=await call('/auth/register',null,{method:'POST',...json({name:'Revoked Member',email:'revoked@example.test',password:'private-revoked-password'})});assert.equal((await call('/auth/invitations/redeem',revoked.headers.getSetCookie()[0].split(';')[0],{method:'POST',...json({invitationCode:revokedInvite.activationKey})})).status,400);
  assert.equal((await call(`/head/circles/${circle.id}/rounds`,headCookie,{method:'POST',...json({period:'2027-01',targetAmount:1500,deadline:'2027-01-15'})})).status,201);
  const round=await(await call(`/head/circles/${circle.id}/dashboard?period=2027-01`,headCookie)).json();assert.equal(round.summary.memberCount,1);assert.equal(round.summary.expectedAmount,1500);
  assert.equal(getDatabase().prepare("SELECT COUNT(*) AS count FROM audit_history WHERE entity_type='circle' AND entity_id=? AND action='frozen'").get(circle.id).count,1);
  const formationHistory=await(await call('/history',headCookie)).json();assert.ok(formationHistory.some(row=>row.entity_type==='membership_request'&&row.action==='approved'));assert.ok(formationHistory.some(row=>row.entity_type==='membership_request'&&row.action==='rejected'));
  assert.equal((await call('/memberships',alphaCookie,{method:'POST',...json({userId:'user-ananya',circleId:circle.id})})).status,410);
});

test('monthly installment payments cap at remaining target and score the obligation once',async()=>{
  const headCreated=await call('/head/circles/circle-women/rounds',headCookie,{method:'POST',...json({period:'2026-12',targetAmount:2000,deadline:'2026-12-15'})});assert.equal(headCreated.status,201);
  const obligation=getDatabase().prepare("SELECT id,membership_id FROM round_members WHERE round_id=(SELECT id FROM contribution_rounds WHERE circle_id='circle-women' AND period='2026-12') AND user_id='user-ananya'").get();
  const create=amount=>call('/payments',memberCookie,{method:'POST',...json({membershipId:obligation.membership_id,roundMemberId:obligation.id,amount,dueDate:'2026-12-15',idempotencyKey:`installment-${amount}-key`})});
  for(const invalid of [0,-1,1.5,'500'])assert.equal((await create(invalid)).status,400,`reject installment amount ${String(invalid)}`);
  const missing=await call('/payments',memberCookie,{method:'POST',...json({membershipId:obligation.membership_id,roundMemberId:obligation.id,dueDate:'2026-12-15',idempotencyKey:'installment-missing-key'})});assert.equal(missing.status,400);
  const first=await create(500);assert.equal(first.status,201);let payment=(await first.json()).payment;
  const pendingProgress=getDatabase().prepare("SELECT COALESCE(SUM(CASE WHEN status='successful' THEN amount ELSE 0 END),0) AS paid FROM contributions WHERE round_member_id=?").get(obligation.id);assert.equal(pendingProgress.paid,0);
  const duplicate=await call('/payments',memberCookie,{method:'POST',...json({membershipId:obligation.membership_id,roundMemberId:obligation.id,amount:500,dueDate:'2026-12-15',idempotencyKey:'installment-500-key'})});assert.equal(duplicate.status,200);assert.equal((await duplicate.json()).payment.id,payment.id);
  await call(`/payments/${payment.id}/settle`,memberCookie,{method:'POST'});
  const tooMuch=await create(1501);assert.equal(tooMuch.status,400);
  const second=await create(1500);assert.equal(second.status,201);payment=(await second.json()).payment;const completed=await call(`/payments/${payment.id}/settle`,memberCookie,{method:'POST'});assert.equal((await completed.json()).payment.status,'successful');
  const progress=getDatabase().prepare("SELECT SUM(CASE WHEN co.status='successful' THEN co.amount ELSE 0 END) AS paid,COUNT(*) AS installments FROM contributions co WHERE co.round_member_id=?").get(obligation.id);assert.equal(progress.paid,2000);assert.equal(progress.installments,2);
  const score=calculateReliabilityScore(getDatabase(),obligation.membership_id);assert.match(score.factors.find(f=>f.key==='consistency').detail,/3 successful contributions across 3 due records/);
  const pendingRound=await(await call('/head/circles/circle-women/dashboard?period=2026-12',headCookie)).json();assert.ok(pendingRound.summary.statusCounts.pending>0);
  const nisha=getDatabase().prepare("SELECT id,membership_id FROM round_members WHERE user_id='user-nisha' AND round_id=(SELECT id FROM contribution_rounds WHERE circle_id='circle-women' AND period='2026-12')").get();
  const failedCreate=await call('/payments',nishaCookie,{method:'POST',...json({membershipId:nisha.membership_id,roundMemberId:nisha.id,amount:2000,dueDate:'2026-12-15',idempotencyKey:'failed-installment-key'})});assert.equal(failedCreate.status,201);
  const failedPayment=(await failedCreate.json()).payment;await settlePayment(getDatabase(),failedPayment.id,{name:'test-provider',settle:async()=>({status:'failed',reference:'TEST-FAIL'})});
  const failedStatus=await(await call('/head/circles/circle-women/dashboard?period=2026-12&status=failed',headCookie)).json();assert.ok(failedStatus.members.some(m=>m.user_id==='user-nisha'));assert.ok(failedStatus.contributions.every(row=>row.status==='failed'));
  const foreign=await call(`/payments/${payment.id}/settle`,headCookie,{method:'POST'});assert.equal(foreign.status,403);
});

test('payment status, idempotency, payout safeguards, and logout remain intact',async()=>{
  const failedCreated=await call('/payments',memberCookie,{method:'POST',...json({membershipId:'membership-women',roundMemberId:getDatabase().prepare("SELECT id FROM round_members WHERE user_id='user-ananya' AND round_id=(SELECT id FROM contribution_rounds WHERE circle_id='circle-women' AND period='2026-10')").get().id,amount:1,dueDate:`${new Date().toISOString().slice(0,7)}-12`,idempotencyKey:'failed-provider-key'})});
  assert.equal(failedCreated.status,400); // The seeded monthly target is already complete.
  const payoutExcess=await call('/head/circles/circle-women/payouts',headCookie,{method:'POST',...json({recipientUserId:'user-nisha',amount:999999,cycleNumber:5})});assert.equal(payoutExcess.status,409);
  const payoutResponse=await call('/head/circles/circle-women/payouts',headCookie,{method:'POST',...json({recipientUserId:'user-nisha',amount:4000,cycleNumber:4})});assert.equal(payoutResponse.status,201);const payout=(await payoutResponse.json()).payout;assert.equal(payout.status,'pending');assert.equal((await call(`/payments/${payout.id}/settle`,headCookie,{method:'POST'})).status,403);
  const logout=await call('/auth/logout',memberCookie,{method:'POST'});assert.equal(logout.status,204);assert.equal((await call('/dashboard',memberCookie)).status,401);
});
