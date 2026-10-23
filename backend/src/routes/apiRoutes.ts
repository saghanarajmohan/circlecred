import { Router } from 'express';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { getDatabase, initializeDatabase } from '../services/database';
import { config } from '../config/env';
import { calculateReliabilityScore } from '../services/scoring';
import { businessDate, businessPeriod, installmentStatus, validDateOnly } from '../services/businessDate';
import { createPayment, settlePayment } from '../services/payments';
import { clearSessionCookie, cookieName, createSession, makePasswordHash, requireAuth, requireManagedCircle, requireRole, setSessionCookie, verifyPassword } from '../services/auth';
import headRoutes from './headRoutes';

const router = Router();
initializeDatabase();
const db = getDatabase();
const asNumber = (v: unknown) => Number.isSafeInteger(v) && Number(v) > 0;
const validDate = validDateOnly;

router.post('/auth/login',(req,res)=>{
  const email=typeof req.body?.email==='string'?req.body.email.trim().toLowerCase():'';
  const password=typeof req.body?.password==='string'?req.body.password:'';
  if(!email||password.length<8||password.length>128)return res.status(400).json({error:'Enter a valid email and password.'});
  const user=db.prepare('SELECT id,name,email,role,password_hash FROM users WHERE email=?').get(email) as {id:string;name:string;email:string;role:'member'|'circle_head';password_hash:string|null}|undefined;
  if(!user||!verifyPassword(password,user.password_hash))return res.status(401).json({error:'Email or password is incorrect.'});
  const session=createSession(user.id);setSessionCookie(res,session.token);
  const managedCircleIds=user.role==='circle_head'?db.prepare('SELECT circle_id FROM circle_heads WHERE user_id=?').all(user.id).map((row)=> (row as {circle_id:string}).circle_id):[];
  return res.json({user:{id:user.id,name:user.name,email:user.email,role:user.role},managedCircleIds,expiresAt:session.expiresAt});
});
router.post('/auth/register',(req,res)=>{
  const name=typeof req.body?.name==='string'?req.body.name.trim():'';
  const email=typeof req.body?.email==='string'?req.body.email.trim().toLowerCase():'';
  const password=typeof req.body?.password==='string'?req.body.password:'';
  if(name.length<2||name.length>100||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||password.length<12||password.length>128)
    return res.status(400).json({error:'Enter a name, valid email, and private password with 12–128 characters.'});
  const userId=randomUUID();
  try {
    db.exec('BEGIN IMMEDIATE');
    db.prepare("INSERT INTO users(id,name,email,role,password_hash) VALUES(?,?,?,'member',?)").run(userId,name,email,makePasswordHash(password));
    db.prepare('INSERT INTO audit_history(entity_type,entity_id,action,new_status,details) VALUES(?,?,?,?,?)').run('user',userId,'registered','member','Public account registration completed.');
    db.exec('COMMIT');
  } catch {
    try{db.exec('ROLLBACK')}catch{}
    return res.status(409).json({error:'An account already uses this email or registration could not be completed.'});
  }
  const session=createSession(userId);setSessionCookie(res,session.token);
  return res.status(201).json({user:{id:userId,name,email,role:'member'},expiresAt:session.expiresAt});
});
router.get('/auth/bootstrap/status',(_req,res)=>{
  const claimed=db.prepare('SELECT 1 FROM system_bootstrap WHERE id=1').get()||db.prepare("SELECT 1 FROM users WHERE role='circle_head' LIMIT 1").get()||db.prepare('SELECT 1 FROM circle_heads LIMIT 1').get();
  return res.json({available:!claimed,configured:Boolean(config.bootstrapToken)});
});
router.post('/auth/bootstrap',(req,res)=>{
  const name=typeof req.body?.name==='string'?req.body.name.trim():'';
  const email=typeof req.body?.email==='string'?req.body.email.trim().toLowerCase():'';
  const password=typeof req.body?.password==='string'?req.body.password:'';
  const bootstrapToken=typeof req.body?.bootstrapToken==='string'?req.body.bootstrapToken:'';
  if(name.length<2||name.length>100||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||password.length<12||password.length>128)
    return res.status(400).json({error:'Enter a name, valid email, and private password with 12–128 characters.'});
  if(!config.bootstrapToken)return res.status(503).json({error:'Initial setup is disabled until the operator configures BOOTSTRAP_TOKEN on the backend.'});
  const expectedTokenHash=createHash('sha256').update(config.bootstrapToken).digest(),providedTokenHash=createHash('sha256').update(bootstrapToken).digest();
  if(bootstrapToken.length>512||!timingSafeEqual(expectedTokenHash,providedTokenHash))return res.status(403).json({error:'The initial setup token is invalid.'});
  db.exec('BEGIN IMMEDIATE');
  try {
    if(db.prepare('SELECT 1 FROM system_bootstrap WHERE id=1').get()||db.prepare("SELECT 1 FROM users WHERE role='circle_head' LIMIT 1").get()||db.prepare('SELECT 1 FROM circle_heads LIMIT 1').get()){
      db.exec('ROLLBACK');return res.status(409).json({error:'Initial Circle Head setup has already been completed.'});
    }
    const userId=randomUUID();
    db.prepare("INSERT INTO users(id,name,email,role,password_hash) VALUES(?,?,?,'circle_head',?)").run(userId,name,email,makePasswordHash(password));
    db.prepare('INSERT INTO system_bootstrap(id,initial_head_user_id) VALUES(1,?)').run(userId);
    db.exec('COMMIT');
    const session=createSession(userId);setSessionCookie(res,session.token);
    return res.status(201).json({user:{id:userId,name,email,role:'circle_head'},expiresAt:session.expiresAt});
  }catch(error){
    try{db.exec('ROLLBACK')}catch{}
    return res.status(409).json({error:'Initial Circle Head account could not be created. Check that the email is not already registered.'});
  }
});
router.get('/auth/me',requireAuth,(req,res)=>{
  const user=req.authUser!;
  const managedCircleIds=user.role==='circle_head'?db.prepare('SELECT circle_id FROM circle_heads WHERE user_id=?').all(user.id).map(row=>(row as {circle_id:string}).circle_id):[];
  return res.json({user,managedCircleIds});
});
router.post('/auth/logout',requireAuth,(req,res)=>{
  const token=req.headers.cookie?.split(';').map(part=>part.trim()).find(part=>part.startsWith(`${cookieName()}=`))?.slice(cookieName().length+1);
  if(token)db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(createHash('sha256').update(token).digest('hex'));
  clearSessionCookie(res);return res.status(204).end();
});
router.post('/auth/activate', (_req,res)=>res.status(410).json({error:'Activation links are no longer supported. Register or sign in, then enter your activation key to request membership.'}));
router.use(requireAuth);
router.use('/head',requireRole('circle_head'),headRoutes);

router.post('/auth/invitations/redeem',(req,res)=>{
  const user=req.authUser!;
  const token=typeof req.body?.invitationCode==='string'?req.body.invitationCode.trim():'';
  if(user.role!=='member')return res.status(403).json({error:'Only a registered member can join a circle using an invitation code.'});
  if(token.length<32||token.length>256)return res.status(400).json({error:'Enter a valid activation key.'});
  const now=Date.now();
  const attempts=db.prepare('SELECT failed_attempts,window_started_at,blocked_until FROM activation_attempt_limits WHERE user_id=?').get(user.id) as {failed_attempts:number;window_started_at:number;blocked_until:number|null}|undefined;
  if(attempts?.blocked_until&&attempts.blocked_until>now)return res.status(429).json({error:'Too many invalid activation keys. Try again later.'});
  const failed=()=>{
    const current=db.prepare('SELECT failed_attempts,window_started_at FROM activation_attempt_limits WHERE user_id=?').get(user.id) as {failed_attempts:number;window_started_at:number}|undefined;
    const freshWindow=!current||now-current.window_started_at>15*60_000;
    const windowStart=freshWindow?now:current!.window_started_at;
    const count=freshWindow?1:current!.failed_attempts+1;
    db.prepare(`INSERT INTO activation_attempt_limits(user_id,failed_attempts,window_started_at,blocked_until) VALUES(?,?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET failed_attempts=excluded.failed_attempts,window_started_at=excluded.window_started_at,blocked_until=excluded.blocked_until`)
      .run(user.id,count,windowStart,count>=10?now+15*60_000:null);
  };
  const tokenHash=createHash('sha256').update(token).digest('hex');
  db.exec('BEGIN IMMEDIATE');
  try {
    const invite=db.prepare("SELECT i.id,i.circle_id,i.email,c.status AS circle_status FROM member_invites i JOIN circles c ON c.id=i.circle_id WHERE i.token_hash=? AND i.status='pending' AND i.expires_at>? ").get(tokenHash,new Date().toISOString()) as {id:string;circle_id:string;email:string;circle_status:string}|undefined;
    if(!invite||invite.circle_status!=='open'||invite.email.toLowerCase()!==user.email.toLowerCase()){
      db.exec('ROLLBACK');failed();return res.status(400).json({error:'Activation key is invalid, expired, revoked, already used, or unavailable.'});
    }
    if(db.prepare('SELECT 1 FROM memberships WHERE user_id=? AND circle_id=?').get(user.id,invite.circle_id)||db.prepare("SELECT 1 FROM membership_requests WHERE user_id=? AND circle_id=? AND status IN ('pending','approved')").get(user.id,invite.circle_id)){
      db.exec('ROLLBACK');return res.status(409).json({error:'You already have a membership or request for this circle.'});
    }
    const capacity=db.prepare('SELECT member_limit,(SELECT COUNT(*) FROM memberships WHERE circle_id=? AND status=\'active\') AS members FROM circles WHERE id=?').get(invite.circle_id,invite.circle_id) as {member_limit:number|null;members:number};
    if(capacity.member_limit!==null&&capacity.members>=capacity.member_limit){db.exec('ROLLBACK');return res.status(409).json({error:'This circle has reached its member capacity.'});}
    const requestId=randomUUID();
    db.prepare('INSERT INTO membership_requests(id,circle_id,user_id,invitation_id) VALUES(?,?,?,?)').run(requestId,invite.circle_id,user.id,invite.id);
    const updated=db.prepare("UPDATE member_invites SET status='accepted' WHERE id=? AND status='pending' AND expires_at>?").run(invite.id,new Date().toISOString());
    if(!updated.changes)throw new Error('Invitation was already used.');
    db.prepare('INSERT INTO audit_history(entity_type,entity_id,action,new_status,details) VALUES(?,?,?,?,?)').run('membership_request',requestId,'requested','pending',`Invitation ${invite.id} redeemed; Circle Head approval required.`);
    db.prepare('DELETE FROM activation_attempt_limits WHERE user_id=?').run(user.id);
    db.exec('COMMIT');
    return res.status(201).json({membershipRequest:{id:requestId,circle_id:invite.circle_id,status:'pending'},message:'Request submitted. The Circle Head must approve it before you can access the circle.'});
  } catch {
    try{db.exec('ROLLBACK')}catch{}
    return res.status(409).json({error:'Could not join this circle; the invitation may already be used or the membership already exists.'});
  }
});

router.get('/membership-requests',(req,res)=>{
  if(req.authUser?.role!=='member')return res.status(403).json({error:'Member access is required.'});
  return res.json(db.prepare(`SELECT mr.id,mr.circle_id,mr.status,mr.requested_at,mr.decided_at,c.name AS circle_name
    FROM membership_requests mr JOIN circles c ON c.id=mr.circle_id WHERE mr.user_id=? ORDER BY mr.requested_at DESC`).all(req.authUser.id));
});

router.get('/dashboard', (req, res) => {
  if(req.authUser?.role!=='member')return res.status(403).json({error:'Member dashboard access is required.'});
  const user = db.prepare('SELECT id,name,email,role FROM users WHERE id=?').get(req.authUser.id);
  if (!user) return res.status(404).json({ error: 'Member not found.' });
  const circles = db.prepare(`SELECT c.*, m.id AS membership_id, m.status AS membership_status,
    (SELECT COUNT(*) FROM memberships WHERE circle_id=c.id AND status='active') AS members,
    (SELECT COUNT(*) FROM contributions WHERE membership_id=m.id AND status='successful') AS paid_count
    FROM memberships m JOIN circles c ON c.id=m.circle_id WHERE m.user_id=?`).all((user as { id: string }).id);
  const period=businessPeriod();
  for(const circle of circles as {id:string;contribution_amount:number;due_day:number;status:string}[]){
    let round=db.prepare('SELECT id,target_amount,deadline FROM contribution_rounds WHERE circle_id=? AND period=?').get(circle.id,period) as {id:string;target_amount:number;deadline:string}|undefined;
    if(!round&&circle.status==='frozen'){
      const [year,month]=period.split('-').map(Number),last=new Date(Date.UTC(year,month,0)).getUTCDate(),deadline=`${period}-${String(Math.min(circle.due_day,last)).padStart(2,'0')}`,id=randomUUID();
      db.exec('BEGIN IMMEDIATE');try{
        db.prepare("INSERT OR IGNORE INTO contribution_rounds(id,circle_id,period,target_amount,deadline,status,created_by) VALUES(?,?,?,?,?,'open',?)").run(id,circle.id,period,circle.contribution_amount,deadline,req.authUser!.id);
        round=db.prepare('SELECT id,target_amount,deadline FROM contribution_rounds WHERE circle_id=? AND period=?').get(circle.id,period) as typeof round;
        const active=db.prepare("SELECT m.id,m.user_id,u.name FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.circle_id=? AND m.status='active'").all(circle.id) as {id:string;user_id:string;name:string}[];
        const add=db.prepare('INSERT OR IGNORE INTO round_members(id,round_id,membership_id,user_id,member_name,target_amount,deadline) VALUES(?,?,?,?,?,?,?)');for(const member of active)add.run(randomUUID(),round!.id,member.id,member.user_id,member.name,round!.target_amount,round!.deadline);
        db.prepare('UPDATE contributions SET round_member_id=(SELECT rm.id FROM round_members rm WHERE rm.round_id=? AND rm.membership_id=contributions.membership_id) WHERE round_member_id IS NULL AND due_date=? AND membership_id IN (SELECT membership_id FROM round_members WHERE round_id=?)').run(round!.id,round!.deadline,round!.id);
        db.exec('COMMIT');
      }catch(error){db.exec('ROLLBACK');throw error;}
    }
  }
  const obligationRows=db.prepare(`SELECT rm.id AS round_member_id,rm.membership_id,rm.target_amount,rm.deadline,r.period,
    COALESCE(SUM(CASE WHEN co.status='successful' THEN co.amount ELSE 0 END),0) AS paid,
    MAX(CASE WHEN co.status='pending' THEN 1 ELSE 0 END) AS has_pending,
    MAX(CASE WHEN co.status='failed' THEN 1 ELSE 0 END) AS has_failed
    FROM round_members rm JOIN contribution_rounds r ON r.id=rm.round_id LEFT JOIN contributions co ON co.round_member_id=rm.id
    WHERE rm.user_id=? AND r.period=? GROUP BY rm.id`).all(req.authUser!.id,period) as {round_member_id:string;membership_id:string;target_amount:number;deadline:string;period:string;paid:number;has_pending:number;has_failed:number}[];
  const obligations=obligationRows.map(row=>({...row,...installmentStatus(row.target_amount,row.paid,row.deadline),hasPending:Boolean(row.has_pending),hasFailed:Boolean(row.has_failed)}));
  const contributions = db.prepare(`SELECT co.*, c.name AS circle_name, p.id AS payment_id, p.provider, p.status AS payment_status
    FROM contributions co JOIN memberships m ON m.id=co.membership_id JOIN circles c ON c.id=m.circle_id
    LEFT JOIN payments p ON p.id=co.payment_id WHERE m.user_id=? ORDER BY co.created_at DESC`).all((user as { id: string }).id);
  const memberships = db.prepare('SELECT id FROM memberships WHERE user_id=?').all((user as { id: string }).id) as {id:string}[];
  const scoreByMembership = Object.fromEntries(memberships.map(m => [m.id, calculateReliabilityScore(db,m.id)]));
  return res.json({ user, circles, contributions, scoreByMembership, obligations, businessDate:businessDate(), businessTimeZone:'Asia/Kolkata' });
});

router.get('/users', (req, res) => {
  if(req.authUser?.role==='circle_head')return res.status(403).json({error:'Use the managed-circle member list.'});
  return res.json(db.prepare('SELECT id,name,email,role,created_at FROM users WHERE id=?').all(req.authUser!.id));
});
router.post('/users', (req, res) => {
  return res.status(410).json({error:'Direct account creation is unavailable. Use a managed-circle invitation and member activation.'});
});
router.patch('/users/:id', (req,res)=>{
  if(req.authUser?.role!=='member'||req.authUser.id!==req.params.id)return res.status(403).json({error:'Members may update only their own profile.'});
  const current=db.prepare('SELECT name,email,phone FROM users WHERE id=?').get(req.params.id) as {name:string;email:string;phone:string|null}|undefined;
  if(!current)return res.status(404).json({error:'Member not found.'});
  const name=req.body?.name??current.name, email=req.body?.email??current.email, phone=req.body?.phone??current.phone;
  if(typeof name!=='string'||name.trim().length<2||typeof email!=='string'||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return res.status(400).json({error:'Provide a name and valid email.'});
  try{db.prepare('UPDATE users SET name=?,email=?,phone=? WHERE id=?').run(name.trim(),email.toLowerCase(),phone,req.params.id);return res.json(db.prepare('SELECT id,name,email,role,created_at FROM users WHERE id=?').get(req.params.id));}
  catch{return res.status(409).json({error:'That email is already registered.'});}
});
router.get('/memberships', (req,res)=>{
  if(req.authUser?.role==='circle_head')return res.status(403).json({error:'Use the managed-circle member list.'});
  return res.json(db.prepare('SELECT m.*,c.name AS circle_name FROM memberships m JOIN circles c ON c.id=m.circle_id WHERE m.user_id=? ORDER BY m.joined_at DESC').all(req.authUser!.id));
});
router.post('/memberships', (_req,res)=>res.status(410).json({error:'Direct membership creation is disabled. Submit a valid activation key and wait for Circle Head approval.'}));
router.get('/circles', (req,res) => req.authUser?.role==='circle_head'
  ?res.json(db.prepare('SELECT c.* FROM circles c JOIN circle_heads h ON h.circle_id=c.id WHERE h.user_id=? ORDER BY c.name').all(req.authUser.id))
  :res.json(db.prepare('SELECT c.* FROM circles c JOIN memberships m ON m.circle_id=c.id WHERE m.user_id=? ORDER BY c.name').all(req.authUser!.id)));
router.post('/circles', (req,res) => {
  if(!req.authUser||!['member','circle_head'].includes(req.authUser.role))return res.status(403).json({error:'Sign in with an account allowed to create a circle.'});
  if(req.authUser.role==='member'&&db.prepare('SELECT 1 FROM memberships WHERE user_id=? LIMIT 1').get(req.authUser.id))return res.status(403).json({error:'A member already in a circle cannot create a new head account through this flow.'});
  const {name,contributionAmount,frequency='monthly',cycleCount=12,dueDay=12,memberLimit=null}=req.body ?? {};
  if(typeof name!=='string'||name.trim().length<2||name.trim().length>100||!asNumber(contributionAmount)||!asNumber(cycleCount)||!['weekly','monthly'].includes(frequency)||!Number.isInteger(dueDay)||dueDay<1||dueDay>28||!(memberLimit===null||asNumber(memberLimit))) return res.status(400).json({error:'Provide a circle name, positive contribution amount, valid frequency, positive cycle count, due day from 1 to 28, and optional positive member limit.'});
  const id=randomUUID();db.exec('BEGIN IMMEDIATE');try{if(req.authUser.role==='member'&&db.prepare('SELECT 1 FROM memberships WHERE user_id=? LIMIT 1').get(req.authUser.id)){db.exec('ROLLBACK');return res.status(403).json({error:'A member already in a circle cannot create a new head account through this flow.'})}db.prepare('INSERT INTO circles (id,name,contribution_amount,frequency,due_day,cycle_count,member_limit,status) VALUES (?,?,?,?,?,?,?,\'open\')').run(id,name.trim(),contributionAmount,frequency,dueDay,cycleCount,memberLimit);db.prepare('INSERT INTO circle_heads(user_id,circle_id) VALUES(?,?)').run(req.authUser.id,id);if(req.authUser.role==='member')db.prepare("UPDATE users SET role='circle_head' WHERE id=? AND role='member'").run(req.authUser.id);db.prepare('INSERT INTO audit_history(entity_type,entity_id,action,new_status,details) VALUES(?,?,?,?,?)').run('circle',id,'created','open',`Circle created open for members with monthly target ${contributionAmount} and due day ${dueDay}.`);db.exec('COMMIT')}catch(error){db.exec('ROLLBACK');return res.status(409).json({error:'Circle could not be created.'})}return res.status(201).json(db.prepare('SELECT * FROM circles WHERE id=?').get(id));
});
router.patch('/circles/:id', (req,res)=>{
  if(req.authUser?.role!=='circle_head')return res.status(403).json({error:'Circle head access is required.'});
  if(!db.prepare('SELECT 1 FROM circle_heads WHERE user_id=? AND circle_id=?').get(req.authUser!.id,req.params.id))return res.status(404).json({error:'Managed circle not found.'});
  const current=db.prepare('SELECT * FROM circles WHERE id=?').get(req.params.id) as {name:string;contribution_amount:number;frequency:string;cycle_count:number}|undefined;
  if(!current)return res.status(404).json({error:'Circle not found.'});
  const name=req.body?.name??current.name, amount=req.body?.contributionAmount??current.contribution_amount, frequency=req.body?.frequency??current.frequency, cycles=req.body?.cycleCount??current.cycle_count;
  if(typeof name!=='string'||name.trim().length<2||!asNumber(amount)||!asNumber(cycles)||!['weekly','monthly'].includes(frequency))return res.status(400).json({error:'Provide valid circle values.'});
  db.prepare('UPDATE circles SET name=?,contribution_amount=?,frequency=?,cycle_count=? WHERE id=?').run(name.trim(),amount,frequency,cycles,req.params.id);
  return res.json(db.prepare('SELECT * FROM circles WHERE id=?').get(req.params.id));
});
router.get('/contributions', (req,res)=>req.authUser?.role==='circle_head'
  ?res.json(db.prepare(`SELECT co.id,co.membership_id,co.amount,co.due_date,co.paid_at,co.status,co.payment_id,c.name AS circle_name FROM contributions co JOIN memberships m ON m.id=co.membership_id JOIN circles c ON c.id=m.circle_id JOIN circle_heads h ON h.circle_id=c.id WHERE h.user_id=? ORDER BY co.created_at DESC`).all(req.authUser.id))
  :res.json(db.prepare(`SELECT co.*,c.name AS circle_name FROM contributions co JOIN memberships m ON m.id=co.membership_id JOIN circles c ON c.id=m.circle_id WHERE m.user_id=? ORDER BY co.created_at DESC`).all(req.authUser!.id)));
router.patch('/contributions/:id/status', (req,res)=>{
  if(req.authUser?.role!=='circle_head')return res.status(403).json({error:'Only the authorized circle head can mark an overdue contribution delayed.'});
  if(req.body?.status!=='delayed')return res.status(400).json({error:'Contribution status can only be marked delayed through this route. Payment success must be confirmed by the payment provider.'});
  const contribution=db.prepare(`SELECT co.* FROM contributions co JOIN memberships m ON m.id=co.membership_id JOIN circle_heads h ON h.circle_id=m.circle_id WHERE co.id=? AND h.user_id=?`).get(req.params.id,req.authUser.id) as {id:string;membership_id:string;status:string;due_date:string}|undefined;
  if(!contribution)return res.status(404).json({error:'Contribution not found.'});
  if(contribution.status!=='pending'||contribution.due_date>=businessDate())return res.status(409).json({error:'Only overdue pending contributions can be marked delayed.'});
  db.prepare("UPDATE contributions SET status='delayed' WHERE id=?").run(req.params.id);
  db.prepare('INSERT INTO audit_history(entity_type,entity_id,action,old_status,new_status,details) VALUES(?,?,?,?,?,?)').run('contribution',req.params.id,'status_changed','pending','delayed','Marked delayed because the due date passed without a confirmed payment.');
  const score=calculateReliabilityScore(db,contribution.membership_id);
  db.prepare('INSERT INTO reliability_scores(membership_id,score,factors_json) VALUES(?,?,?)').run(contribution.membership_id,score.score,JSON.stringify(score.factors));
  return res.json(db.prepare('SELECT * FROM contributions WHERE id=?').get(req.params.id));
});
router.get('/payments', (req,res)=>req.authUser?.role==='circle_head'
  ?res.json(db.prepare('SELECT p.id,p.contribution_id,p.membership_id,p.amount,p.status,p.provider,p.provider_reference,p.created_at,p.updated_at,c.name AS circle_name FROM payments p JOIN memberships m ON m.id=p.membership_id JOIN circles c ON c.id=m.circle_id JOIN circle_heads h ON h.circle_id=c.id WHERE h.user_id=? ORDER BY p.created_at DESC').all(req.authUser.id))
  :res.json(db.prepare('SELECT p.*,c.name AS circle_name FROM payments p JOIN memberships m ON m.id=p.membership_id JOIN circles c ON c.id=m.circle_id WHERE m.user_id=? ORDER BY p.created_at DESC').all(req.authUser!.id)));
router.post('/payments', (req,res)=>{
  if(req.authUser?.role!=='member')return res.status(403).json({error:'Only members can create contribution payments.'});
  const {membershipId,amount,dueDate,idempotencyKey,roundMemberId}=req.body ?? {};
  if(typeof membershipId!=='string'||!asNumber(amount)||!validDate(dueDate)||typeof idempotencyKey!=='string'||idempotencyKey.length<8||idempotencyKey.length>128||typeof roundMemberId!=='string') return res.status(400).json({error:'membershipId, positive installment amount, YYYY-MM-DD dueDate, roundMemberId, and an idempotencyKey (8–128 chars) are required.'});
  if(!db.prepare("SELECT 1 FROM memberships WHERE id=? AND user_id=? AND status='active'").get(membershipId,req.authUser.id))return res.status(404).json({error:'Active member circle not found.'});
  try { const result=createPayment(db,{membershipId,amount,dueDate,idempotencyKey,roundMemberId}); return res.status(result.duplicate?200:201).json({...result,simulated:true,message:'Simulated payment only. No real money was transferred.'}); }
  catch(error){ return res.status(400).json({error:error instanceof Error?error.message:'Could not create payment.'}); }
});
router.post('/payments/:id/settle', async (req,res)=>{
  if(req.authUser?.role!=='member')return res.status(403).json({error:'Circle heads cannot settle member payments.'});
  if(!db.prepare('SELECT 1 FROM payments p JOIN memberships m ON m.id=p.membership_id WHERE p.id=? AND m.user_id=?').get(req.params.id,req.authUser.id))return res.status(404).json({error:'Payment not found.'});
  try { const result=await settlePayment(db,req.params.id); return res.json({...result,simulated:true,message:'Simulated payment only. No real money was transferred.'}); }
  catch(error){ return res.status(error instanceof Error&&error.message==='Payment not found'?404:400).json({error:error instanceof Error?error.message:'Could not settle payment.'}); }
});
router.post('/payouts', (req,res)=>{
  if(req.authUser?.role!=='circle_head')return res.status(403).json({error:'Circle head access is required.'});
  const {circleId,recipientUserId,amount,cycleNumber}=req.body ?? {};
  if(typeof circleId!=='string'||typeof recipientUserId!=='string'||!asNumber(amount)||!asNumber(cycleNumber)) return res.status(400).json({error:'circleId, recipientUserId, positive amount, and positive cycleNumber are required.'});
  if(!db.prepare('SELECT 1 FROM circle_heads WHERE user_id=? AND circle_id=?').get(req.authUser.id,circleId)||!db.prepare("SELECT 1 FROM memberships WHERE circle_id=? AND user_id=? AND status='active'").get(circleId,recipientUserId))return res.status(404).json({error:'Managed circle or active payout recipient not found.'});
  const collected=(db.prepare("SELECT COALESCE(SUM(co.amount),0) AS total FROM contributions co JOIN memberships m ON m.id=co.membership_id WHERE m.circle_id=? AND co.status='successful'").get(circleId) as {total:number}).total;
  const allocated=(db.prepare("SELECT COALESCE(SUM(amount),0) AS total FROM payouts WHERE circle_id=? AND status IN ('pending','successful')").get(circleId) as {total:number}).total;
  if(amount>collected-allocated)return res.status(409).json({error:'Payout request exceeds collected funds not already allocated.'});
  try { const id=randomUUID(); db.prepare("INSERT INTO payouts (id,circle_id,recipient_user_id,amount,cycle_number,status) VALUES (?,?,?,?,?,'pending')").run(id,circleId,recipientUserId,amount,cycleNumber); db.prepare('INSERT INTO audit_history(entity_type,entity_id,action,new_status,details) VALUES (?,?,?,?,?)').run('payout',id,'recorded','pending','Payout request recorded; provider confirmation is required before success.'); return res.status(201).json({payout:db.prepare('SELECT id,circle_id,recipient_user_id,amount,cycle_number,status,created_at FROM payouts WHERE id=?').get(id),simulated:true}); }
  catch { return res.status(409).json({error:'Payout could not be recorded. Check circle, recipient, and cycle uniqueness.'}); }
});
router.get('/payouts', (req,res)=>req.authUser?.role==='circle_head'
  ?res.json({payouts:db.prepare('SELECT p.id,p.circle_id,p.recipient_user_id,p.amount,p.cycle_number,p.status,p.paid_at,p.created_at,c.name AS circle_name,u.name AS recipient_name FROM payouts p JOIN circles c ON c.id=p.circle_id JOIN users u ON u.id=p.recipient_user_id JOIN circle_heads h ON h.circle_id=c.id WHERE h.user_id=? ORDER BY p.created_at DESC').all(req.authUser.id),simulated:true})
  :res.json({payouts:db.prepare('SELECT p.id,p.circle_id,p.amount,p.cycle_number,p.status,p.paid_at,p.created_at,c.name AS circle_name FROM payouts p JOIN circles c ON c.id=p.circle_id JOIN memberships m ON m.circle_id=c.id WHERE m.user_id=? ORDER BY p.created_at DESC').all(req.authUser!.id),simulated:true}));
router.get('/history', (req,res)=>req.authUser?.role==='circle_head'
  ?res.json(db.prepare(`SELECT a.id,a.entity_type,a.entity_id,a.action,a.old_status,a.new_status,a.details,a.created_at FROM audit_history a
    WHERE EXISTS(SELECT 1 FROM payments p JOIN memberships m ON m.id=p.membership_id JOIN circle_heads h ON h.circle_id=m.circle_id WHERE p.id=a.entity_id AND h.user_id=?)
    OR EXISTS(SELECT 1 FROM payouts p JOIN circle_heads h ON h.circle_id=p.circle_id WHERE p.id=a.entity_id AND h.user_id=?)
    OR (a.entity_type='circle' AND EXISTS(SELECT 1 FROM circle_heads h WHERE h.circle_id=a.entity_id AND h.user_id=?))
    OR EXISTS(SELECT 1 FROM contribution_rounds r JOIN circle_heads h ON h.circle_id=r.circle_id WHERE r.id=a.entity_id AND h.user_id=?)
    OR EXISTS(SELECT 1 FROM member_invites i JOIN circle_heads h ON h.circle_id=i.circle_id WHERE i.id=a.entity_id AND h.user_id=?)
    OR EXISTS(SELECT 1 FROM memberships m JOIN circle_heads h ON h.circle_id=m.circle_id WHERE m.id=a.entity_id AND h.user_id=?)
    OR EXISTS(SELECT 1 FROM membership_requests mr JOIN circle_heads h ON h.circle_id=mr.circle_id WHERE mr.id=a.entity_id AND h.user_id=?) ORDER BY a.created_at DESC,a.id DESC`).all(req.authUser.id,req.authUser.id,req.authUser.id,req.authUser.id,req.authUser.id,req.authUser.id,req.authUser.id))
  :res.json(db.prepare(`SELECT a.id,a.entity_type,a.entity_id,a.action,a.old_status,a.new_status,a.details,a.created_at FROM audit_history a
    WHERE EXISTS(SELECT 1 FROM payments p JOIN memberships m ON m.id=p.membership_id WHERE p.id=a.entity_id AND m.user_id=?)
    OR EXISTS(SELECT 1 FROM membership_requests mr WHERE mr.id=a.entity_id AND mr.user_id=?) ORDER BY a.created_at DESC,a.id DESC`).all(req.authUser!.id,req.authUser!.id)));
router.get('/memberships/:id/score', (req,res)=>{
  if(req.authUser?.role!=='member'||!db.prepare('SELECT 1 FROM memberships WHERE id=? AND user_id=?').get(req.params.id,req.authUser.id))return res.status(404).json({error:'Member circle not found.'});
  try{return res.json(calculateReliabilityScore(db,req.params.id));}catch{return res.status(404).json({error:'Membership not found.'});}
});
router.get('/members/:id/score', (req,res)=>{
  if(req.authUser?.role!=='member'||req.authUser.id!==req.params.id)return res.status(404).json({error:'Member not found.'});
  const memberships=db.prepare('SELECT id FROM memberships WHERE user_id=?').all(req.params.id) as {id:string}[];
  if(!memberships.length)return res.status(404).json({error:'Member not found.'});
  const results=memberships.map(m=>({membershipId:m.id,...calculateReliabilityScore(db,m.id)}));
  return res.json({membershipScores:results,score:Math.round(results.reduce((s,x)=>s+x.score,0)/results.length),maxScore:850,disclaimer:'An internal savings reliability indicator only. It is not an official credit score and does not guarantee loan approval.'});
});

export default router;
