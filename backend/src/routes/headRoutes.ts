import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Router } from 'express';
import { getDatabase } from '../services/database';
import { requireManagedCircle } from '../services/auth';
import { businessDate, businessPeriod, installmentStatus, validDateOnly } from '../services/businessDate';

const router=Router();
const db=getDatabase();
const positive=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>0;
const dateValid=validDateOnly;
const validPeriod=(value:unknown)=>typeof value==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(value);
const today=businessDate;
const ensureRound=(circleId:string,period:string,createdBy:string)=>{
  let round=db.prepare('SELECT * FROM contribution_rounds WHERE circle_id=? AND period=?').get(circleId,period) as {id:string;circle_id:string;period:string;target_amount:number;deadline:string;status:'open'|'closed'}|undefined;
  if(round)return round;
  const circle=db.prepare('SELECT contribution_amount,due_day FROM circles WHERE id=?').get(circleId) as {contribution_amount:number;due_day:number};
  const [year,month]=period.split('-').map(Number);const last=new Date(Date.UTC(year,month,0)).getUTCDate();
  const deadline=`${period}-${String(Math.min(circle.due_day,last)).padStart(2,'0')}`;
  const id=randomUUID();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare("INSERT OR IGNORE INTO contribution_rounds(id,circle_id,period,target_amount,deadline,status,created_by) VALUES(?,?,?,?,?,'open',?)").run(id,circleId,period,circle.contribution_amount,deadline,createdBy);
    round=db.prepare('SELECT * FROM contribution_rounds WHERE circle_id=? AND period=?').get(circleId,period) as typeof round;
    const members=db.prepare("SELECT m.id,m.user_id,u.name FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.circle_id=? AND m.status='active' ORDER BY u.name").all(circleId) as {id:string;user_id:string;name:string}[];
    const add=db.prepare('INSERT OR IGNORE INTO round_members(id,round_id,membership_id,user_id,member_name,target_amount,deadline) VALUES(?,?,?,?,?,?,?)');
    for(const member of members)add.run(randomUUID(),round!.id,member.id,member.user_id,member.name,round!.target_amount,round!.deadline);
    db.prepare('UPDATE contributions SET round_member_id=(SELECT rm.id FROM round_members rm WHERE rm.round_id=? AND rm.membership_id=contributions.membership_id) WHERE round_member_id IS NULL AND due_date=? AND membership_id IN (SELECT membership_id FROM round_members WHERE round_id=?)').run(round!.id,round!.deadline,round!.id);
    db.exec('COMMIT');
    return round!;
  } catch(error) { db.exec('ROLLBACK'); throw error; }
};

router.get('/circles',(_req,res)=>res.json(db.prepare(`SELECT c.id,c.name,c.contribution_amount,c.frequency,c.due_day,c.cycle_count,c.status,c.frozen_at,c.member_limit,
  (SELECT COUNT(*) FROM memberships m WHERE m.circle_id=c.id AND m.status='active') AS member_count,
  (SELECT COUNT(*) FROM membership_requests mr WHERE mr.circle_id=c.id AND mr.status='pending') AS pending_count,
  CASE WHEN c.member_limit IS NULL THEN NULL ELSE MAX(0,c.member_limit-(SELECT COUNT(*) FROM memberships m WHERE m.circle_id=c.id AND m.status='active')) END AS remaining_capacity
  FROM circle_heads h JOIN circles c ON c.id=h.circle_id WHERE h.user_id=? ORDER BY c.name`).all(_req.authUser!.id)));

router.get('/circles/:circleId/members',requireManagedCircle,(req,res)=>{
  const members=db.prepare(`SELECT m.id AS membership_id,m.user_id AS member_id,u.name,u.email,u.phone,m.status,m.joined_at,
    (SELECT id FROM member_invites i WHERE i.email=u.email AND i.circle_id=m.circle_id AND i.status='accepted' ORDER BY created_at DESC LIMIT 1) AS invite_id
    FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.circle_id=? ORDER BY m.joined_at DESC`).all(String(req.params.circleId));
  const invitations=db.prepare('SELECT id,name,email,phone,status,expires_at,created_at FROM member_invites WHERE circle_id=? ORDER BY created_at DESC LIMIT 100').all(String(req.params.circleId));
  const applications=db.prepare(`SELECT mr.id AS request_id,mr.status,mr.requested_at,u.id AS user_id,u.name,u.email,u.phone
    FROM membership_requests mr JOIN users u ON u.id=mr.user_id WHERE mr.circle_id=? AND mr.status='pending' ORDER BY mr.requested_at`).all(String(req.params.circleId));
  const circle=db.prepare('SELECT id,name,status,frozen_at,member_limit FROM circles WHERE id=?').get(String(req.params.circleId));
  return res.json({circle,members,invitations,applications});
});

router.post('/circles/:circleId/invitations',requireManagedCircle,(req,res)=>{
  const circleId=String(req.params.circleId);const name=typeof req.body?.name==='string'?req.body.name.trim():'';
  const email=typeof req.body?.email==='string'?req.body.email.trim().toLowerCase():'';const phone=typeof req.body?.phone==='string'?req.body.phone.trim()||null:null;
  if(name.length<2||name.length>100||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||phone&&phone.length>30)return res.status(400).json({error:'Enter a member name, valid email, and optional phone number.'});
  const circle=db.prepare('SELECT status,member_limit FROM circles WHERE id=?').get(circleId) as {status:string;member_limit:number|null};
  if(circle.status!=='open')return res.status(409).json({error:'This circle is frozen and is not accepting new invitations.'});
  if(db.prepare('SELECT 1 FROM memberships WHERE circle_id=? AND user_id=(SELECT id FROM users WHERE email=?)').get(circleId,email)||db.prepare('SELECT 1 FROM membership_requests mr JOIN users u ON u.id=mr.user_id WHERE mr.circle_id=? AND u.email=?').get(circleId,email))return res.status(409).json({error:'This account already has membership or an application in this circle.'});
  const id=randomUUID(),token=randomBytes(32).toString('base64url'),tokenHash=createHash('sha256').update(token).digest('hex');
  const expiresAt=new Date(Date.now()+7*86400000).toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    const currentCircle=db.prepare("SELECT status,member_limit,(SELECT COUNT(*) FROM memberships WHERE circle_id=? AND status='active') AS members FROM circles WHERE id=?").get(circleId,circleId) as {status:string;member_limit:number|null;members:number}|undefined;
    if(!currentCircle||currentCircle.status!=='open'){db.exec('ROLLBACK');return res.status(409).json({error:'This circle has been frozen and is not accepting new invitations.'});}
    if(currentCircle.member_limit!==null&&currentCircle.members>=currentCircle.member_limit){db.exec('ROLLBACK');return res.status(409).json({error:'This circle has reached its member capacity.'});}
    db.prepare("UPDATE member_invites SET status='revoked' WHERE circle_id=? AND email=? AND status='pending' AND expires_at<=?").run(circleId,email,new Date().toISOString());
    if(db.prepare("SELECT 1 FROM member_invites WHERE circle_id=? AND email=? AND status='pending'").get(circleId,email)){db.exec('ROLLBACK');return res.status(409).json({error:'A pending invitation already exists for this email in this circle.'});}
    db.prepare('INSERT INTO member_invites(id,circle_id,name,email,phone,token_hash,expires_at,created_by) VALUES(?,?,?,?,?,?,?,?)').run(id,circleId,name,email,phone,tokenHash,expiresAt,req.authUser!.id);
    db.prepare('INSERT INTO audit_history(entity_type,entity_id,action,details) VALUES(?,?,?,?)').run('invitation',id,'created',`Member invitation created for ${email}; expires ${expiresAt}.`);
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');return res.status(409).json({error:'A pending invitation already exists or could not be created.'});}
  return res.status(201).json({invitation:{id,name,email,phone,status:'pending',expires_at:expiresAt},activationKey:token});
});

router.patch('/circles/:circleId/invitations/:invitationId',requireManagedCircle,(req,res)=>{
  const circleId=String(req.params.circleId),invitationId=String(req.params.invitationId);
  db.exec('BEGIN IMMEDIATE');
  const invite=db.prepare("SELECT id,status FROM member_invites WHERE id=? AND circle_id=?").get(invitationId,circleId) as {id:string;status:string}|undefined;
  if(!invite){db.exec('ROLLBACK');return res.status(404).json({error:'Invitation not found in this managed circle.'});}
  if(invite.status!=='pending'){db.exec('ROLLBACK');return res.status(409).json({error:'Only unused invitations can be revoked.'});}
  try{db.prepare("UPDATE member_invites SET status='revoked' WHERE id=? AND status='pending'").run(invitationId);db.prepare('INSERT INTO audit_history(entity_type,entity_id,action,old_status,new_status,details) VALUES(?,?,?,?,?,?)').run('invitation',invitationId,'revoked','pending','revoked','Circle Head revoked the activation key.');db.exec('COMMIT')}catch(error){db.exec('ROLLBACK');throw error;}
  return res.json({invitation:{id:invitationId,status:'revoked'}});
});

router.post('/circles/:circleId/applications/:requestId/decision',requireManagedCircle,(req,res)=>{
  const circleId=String(req.params.circleId),requestId=String(req.params.requestId),decision=req.body?.decision;
  if(!['approved','rejected'].includes(decision))return res.status(400).json({error:'Decision must be approved or rejected.'});
  const application=db.prepare("SELECT mr.id,mr.user_id,mr.status,c.status AS circle_status,c.member_limit FROM membership_requests mr JOIN circles c ON c.id=mr.circle_id WHERE mr.id=? AND mr.circle_id=?").get(requestId,circleId) as {id:string;user_id:string;status:string;circle_status:string;member_limit:number|null}|undefined;
  if(!application)return res.status(404).json({error:'Application not found in this managed circle.'});
  if(application.status!=='pending')return res.status(409).json({error:'This application has already been decided.'});
  if(application.circle_status!=='open')return res.status(409).json({error:'The approved roster is frozen; applications cannot change membership.'});
  db.exec('BEGIN IMMEDIATE');try{
    const current=db.prepare('SELECT mr.status,c.status AS circle_status FROM membership_requests mr JOIN circles c ON c.id=mr.circle_id WHERE mr.id=? AND mr.circle_id=?').get(requestId,circleId) as {status:string;circle_status:string}|undefined;
    if(!current||current.status!=='pending'||current.circle_status!=='open'){db.exec('ROLLBACK');return res.status(409).json({error:'This application was already decided or the circle roster was frozen.'});}
    if(decision==='approved'){
      const count=(db.prepare("SELECT COUNT(*) AS count FROM memberships WHERE circle_id=? AND status='active'").get(circleId) as {count:number}).count;
      if(application.member_limit!==null&&count>=application.member_limit){db.exec('ROLLBACK');return res.status(409).json({error:'This circle has reached its member capacity.'});}
      const membershipId=randomUUID();db.prepare("INSERT INTO memberships(id,user_id,circle_id,status) VALUES(?,?,?,'active')").run(membershipId,application.user_id,circleId);
    }
    db.prepare('UPDATE membership_requests SET status=?,decided_at=CURRENT_TIMESTAMP,decided_by=? WHERE id=? AND status=\'pending\'').run(decision,req.authUser!.id,requestId);
    db.prepare('INSERT INTO audit_history(entity_type,entity_id,action,old_status,new_status,details) VALUES(?,?,?,?,?,?)').run('membership_request',requestId,decision,'pending',decision,`Circle Head ${req.authUser!.id} ${decision} the join request.`);
    db.exec('COMMIT');
  }catch(error){try{db.exec('ROLLBACK')}catch{}return res.status(409).json({error:'Application decision could not be recorded; check whether this user is already a member.'});}
  return res.json({application:{id:requestId,status:decision}});
});

router.post('/circles/:circleId/freeze',requireManagedCircle,(req,res)=>{
  const circleId=String(req.params.circleId);
  db.exec('BEGIN IMMEDIATE');
  try{
    const circle=db.prepare('SELECT * FROM circles WHERE id=?').get(circleId) as {id:string;status:string;contribution_amount:number;due_day:number;member_limit:number|null;frozen_at:string|null};
    if(circle.status==='frozen'){db.exec('ROLLBACK');return res.status(409).json({error:'This circle is already frozen.'});}
    const approved=db.prepare("SELECT m.id,m.user_id,u.name FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.circle_id=? AND m.status='active' ORDER BY u.name").all(circleId) as {id:string;user_id:string;name:string}[];
    const pending=(db.prepare("SELECT COUNT(*) AS count FROM membership_requests WHERE circle_id=? AND status='pending'").get(circleId) as {count:number}).count;
    if(!approved.length){db.exec('ROLLBACK');return res.status(409).json({error:'Approve at least one member before freezing the circle.'});}
    if(pending){db.exec('ROLLBACK');return res.status(409).json({error:`Resolve all ${pending} pending application(s) before freezing. No applications were approved or discarded.`});}
    const frozenAt=new Date().toISOString();db.prepare("UPDATE circles SET status='frozen',frozen_at=? WHERE id=? AND status='open'").run(frozenAt,circleId);
    db.prepare('INSERT INTO audit_history(entity_type,entity_id,action,old_status,new_status,details) VALUES(?,?,?,?,?,?)').run('circle',circleId,'frozen','open','frozen',JSON.stringify({approvedMemberCount:approved.length,frozenAt,actor:req.authUser!.id}));
    // Freeze is the explicit action that creates the initial snapshot. Existing period rows are never rewritten.
    const period=businessPeriod();let round=db.prepare('SELECT * FROM contribution_rounds WHERE circle_id=? AND period=?').get(circleId,period) as {id:string}|undefined;
    if(!round){const [year,month]=period.split('-').map(Number),last=new Date(Date.UTC(year,month,0)).getUTCDate(),deadline=`${period}-${String(Math.min(circle.due_day,last)).padStart(2,'0')}`,roundId=randomUUID();
      db.prepare("INSERT INTO contribution_rounds(id,circle_id,period,target_amount,deadline,status,created_by) VALUES(?,?,?,?,?,'open',?)").run(roundId,circleId,period,circle.contribution_amount,deadline,req.authUser!.id);
      const add=db.prepare('INSERT INTO round_members(id,round_id,membership_id,user_id,member_name,target_amount,deadline) VALUES(?,?,?,?,?,?,?)');for(const member of approved)add.run(randomUUID(),roundId,member.id,member.user_id,member.name,circle.contribution_amount,deadline);
      round=db.prepare('SELECT * FROM contribution_rounds WHERE id=?').get(roundId) as {id:string};
      db.prepare('INSERT INTO audit_history(entity_type,entity_id,action,new_status,details) VALUES(?,?,?,?,?)').run('round',roundId,'started','open',`Initial round ${period} snapshotted when circle was frozen with ${approved.length} approved members.`);
    }
    db.exec('COMMIT');return res.json({circle:db.prepare('SELECT * FROM circles WHERE id=?').get(circleId),round,eligibleMembers:approved.length});
  }catch(error){try{db.exec('ROLLBACK')}catch{}return res.status(409).json({error:'Circle could not be frozen; retry after reviewing pending applications.'});}
});

router.patch('/circles/:circleId/members/:membershipId',requireManagedCircle,(req,res)=>{
  const circleId=String(req.params.circleId),membershipId=String(req.params.membershipId);const status=req.body?.status;
  if(!['active','left'].includes(status))return res.status(400).json({error:'Membership status must be active or left.'});
  const membership=db.prepare('SELECT status FROM memberships WHERE id=? AND circle_id=?').get(membershipId,circleId) as {status:string}|undefined;
  if(!membership)return res.status(404).json({error:'Member not found in this managed circle.'});
  if(db.prepare("SELECT 1 FROM circles WHERE id=? AND status='frozen'").get(circleId))return res.status(409).json({error:'The approved member roster is frozen and cannot be changed.'});
  if(membership.status===status)return res.json({membership:{id:membershipId,status}});
  db.exec('BEGIN IMMEDIATE');try{
    const circleState=db.prepare('SELECT status FROM circles WHERE id=?').get(circleId) as {status:string}|undefined;
    const memberState=db.prepare('SELECT status FROM memberships WHERE id=? AND circle_id=?').get(membershipId,circleId) as {status:string}|undefined;
    if(!circleState||circleState.status==='frozen'){db.exec('ROLLBACK');return res.status(409).json({error:'The approved member roster is frozen and cannot be changed.'});}
    if(!memberState){db.exec('ROLLBACK');return res.status(404).json({error:'Member not found in this managed circle.'});}
    if(memberState.status===status){db.exec('ROLLBACK');return res.json({membership:{id:membershipId,status}});}
    db.prepare('UPDATE memberships SET status=? WHERE id=? AND circle_id=?').run(status,membershipId,circleId);
    db.prepare('INSERT INTO audit_history(entity_type,entity_id,action,old_status,new_status,details) VALUES(?,?,?,?,?,?)').run('membership',membershipId,'status_changed',memberState.status,status,'Membership change applies to future rounds; existing round snapshots remain unchanged.');
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  return res.json({membership:{id:membershipId,status}});
});

router.post('/circles/:circleId/rounds',requireManagedCircle,(req,res)=>{
  const circleId=String(req.params.circleId),period=req.body?.period,amount=req.body?.targetAmount,deadline=req.body?.deadline;
  if(!db.prepare("SELECT 1 FROM circles WHERE id=? AND status='frozen'").get(circleId))return res.status(409).json({error:'Freeze the circle first. Its approved roster must be fixed before starting monthly rounds.'});
  if(!validPeriod(period)||!positive(amount)||!dateValid(deadline)||String(deadline).slice(0,7)!==period)return res.status(400).json({error:'Provide a valid YYYY-MM period, positive target amount, and deadline within that month.'});
  try{
    db.exec('BEGIN IMMEDIATE');const id=randomUUID();
    db.prepare("INSERT INTO contribution_rounds(id,circle_id,period,target_amount,deadline,status,created_by) VALUES(?,?,?,?,?,'open',?)").run(id,circleId,period,amount,deadline,req.authUser!.id);
    const members=db.prepare("SELECT m.id,m.user_id,u.name FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.circle_id=? AND m.status='active'").all(circleId) as {id:string;user_id:string;name:string}[];
    const add=db.prepare('INSERT INTO round_members(id,round_id,membership_id,user_id,member_name,target_amount,deadline) VALUES(?,?,?,?,?,?,?)');for(const member of members)add.run(randomUUID(),id,member.id,member.user_id,member.name,amount,deadline);
    db.prepare('INSERT INTO audit_history(entity_type,entity_id,action,new_status,details) VALUES(?,?,?,?,?)').run('round',id,'started','open',`Monthly round ${period} started with ${members.length} eligible members, target ${amount}, deadline ${deadline}.`);
    db.exec('COMMIT');return res.status(201).json({round:db.prepare('SELECT * FROM contribution_rounds WHERE id=?').get(id),expectedPool:amount*members.length,eligibleMembers:members.length});
  }catch(error){try{db.exec('ROLLBACK')}catch{}return res.status(409).json({error:'A round already exists for this circle and month.'});}
});

router.patch('/circles/:circleId/rounds/:roundId/adjust',requireManagedCircle,(req,res)=>{
  const circleId=String(req.params.circleId),roundId=String(req.params.roundId),amount=req.body?.targetAmount,deadline=req.body?.deadline,reason=typeof req.body?.reason==='string'?req.body.reason.trim():'';
  if(!positive(amount)||!dateValid(deadline)||reason.length<10||reason.length>500)return res.status(400).json({error:'Provide a positive target, valid deadline, and adjustment reason (10–500 characters).'});
  const round=db.prepare("SELECT id,period FROM contribution_rounds WHERE id=? AND circle_id=? AND status='open'").get(roundId,circleId) as {id:string;period:string}|undefined;
  if(!round)return res.status(404).json({error:'Open round not found in this managed circle.'});
  if(String(deadline).slice(0,7)!==round.period)return res.status(400).json({error:'Adjusted deadline must remain within the round month.'});
  db.exec('BEGIN IMMEDIATE');try{
    const previous=db.prepare('SELECT target_amount,deadline FROM contribution_rounds WHERE id=?').get(roundId) as {target_amount:number;deadline:string};
    db.prepare('UPDATE contribution_rounds SET target_amount=?,deadline=? WHERE id=?').run(amount,deadline,roundId);
    db.prepare('UPDATE round_members SET target_amount=?,deadline=? WHERE round_id=?').run(amount,deadline,roundId);
    db.prepare('INSERT INTO audit_history(entity_type,entity_id,action,details) VALUES(?,?,?,?)').run('round',roundId,'explicit_adjustment',JSON.stringify({reason,previousTarget:previous.target_amount,targetAmount:amount,previousDeadline:previous.deadline,deadline,adjustedBy:req.authUser!.id}));
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  return res.json({round:db.prepare('SELECT * FROM contribution_rounds WHERE id=?').get(roundId)});
});

router.get('/circles/:circleId/dashboard',requireManagedCircle,(req,res)=>{
  const period=req.query.period===undefined?businessPeriod():req.query.period;
  if(!validPeriod(period))return res.status(400).json({error:'Period must use YYYY-MM format.'});
  const periodValue=String(period);const circleId=String(req.params.circleId);const circle=db.prepare('SELECT id,name,contribution_amount,frequency,due_day,cycle_count,status,frozen_at,member_limit FROM circles WHERE id=?').get(circleId) as {id:string;name:string;contribution_amount:number;frequency:string;due_day:number;cycle_count:number;status:string;frozen_at:string|null;member_limit:number|null};
  let round=db.prepare('SELECT * FROM contribution_rounds WHERE circle_id=? AND period=?').get(circleId,periodValue) as {id:string;circle_id:string;period:string;target_amount:number;deadline:string;status:string}|undefined;
  if(!round&&circle.status==='frozen'&&periodValue===businessPeriod())round=ensureRound(circleId,periodValue,req.authUser!.id);
  let roundMembers=round?db.prepare(`SELECT rm.id,rm.membership_id,rm.user_id,rm.member_name AS name,rm.target_amount,rm.deadline,
    COALESCE(SUM(CASE WHEN co.status='successful' THEN co.amount ELSE 0 END),0) AS paid,
    MAX(CASE WHEN co.status='pending' THEN 1 ELSE 0 END) AS has_pending,
    MAX(CASE WHEN co.status='failed' THEN 1 ELSE 0 END) AS has_failed
    FROM round_members rm LEFT JOIN contributions co ON co.round_member_id=rm.id WHERE rm.round_id=? GROUP BY rm.id ORDER BY rm.member_name`).all(round.id) as {id:string;membership_id:string;user_id:string;name:string;target_amount:number;deadline:string;paid:number;has_pending:number;has_failed:number}[]:[];
  const memberFilter=typeof req.query.memberId==='string'?req.query.memberId:undefined;
  if(memberFilter&&round&&!roundMembers.some(row=>row.user_id===memberFilter))return res.status(404).json({error:'Member is not eligible for this round.'});
  const allowed=['all','paid','pending','failed','overdue','upcoming','due_today','partially_paid'];if(req.query.status!==undefined&&(typeof req.query.status!=='string'||!allowed.includes(req.query.status)))return res.status(400).json({error:'Unsupported contribution status filter.'});
  const memberRows=memberFilter?roundMembers.filter(row=>row.user_id===memberFilter):roundMembers;
  const members=memberRows.map(row=>({...row,...installmentStatus(row.target_amount,row.paid,row.deadline),hasPending:Boolean(row.has_pending),hasFailed:Boolean(row.has_failed),consistencyPercent:row.target_amount?Math.min(100,Math.round(row.paid/row.target_amount*100)):0}));
  const status=typeof req.query.status==='string'?req.query.status:'all';
  const visibleMembers=status==='all'?members:status==='failed'?members.filter(m=>m.has_failed):status==='pending'?members.filter(m=>m.timingStatus==='upcoming'||m.timingStatus==='due_today'):status==='upcoming'||status==='due_today'||status==='overdue'?members.filter(m=>m.timingStatus===status):members.filter(m=>m.status===status);
  const visibleIds=new Set(visibleMembers.map(member=>member.id));
  const collectedAmount=members.reduce((sum,row)=>sum+row.paid,0),expectedAmount=members.reduce((sum,row)=>sum+row.target_amount,0);
  let contributions=round?db.prepare(`SELECT co.id,co.round_member_id,co.membership_id,co.amount,co.due_date,co.paid_at,co.status,p.id AS transaction_id,rm.member_name
    FROM contributions co JOIN round_members rm ON rm.id=co.round_member_id LEFT JOIN payments p ON p.id=co.payment_id WHERE rm.round_id=? ORDER BY co.created_at DESC`).all(round.id).filter((row:any)=>visibleIds.has(row.round_member_id)):[];
  if(status==='pending'||status==='failed')contributions=contributions.filter((row:any)=>row.status===status);
  if(status==='paid')contributions=contributions.filter((row:any)=>row.status==='successful');
  const payments=db.prepare(`SELECT p.id,p.status,p.amount,p.created_at AS date,'contribution' AS type,u.name AS member_name FROM payments p JOIN memberships m ON m.id=p.membership_id JOIN users u ON u.id=m.user_id WHERE m.circle_id=?
    UNION ALL SELECT po.id,po.status,po.amount,po.created_at AS date,'payout' AS type,u.name AS member_name FROM payouts po JOIN users u ON u.id=po.recipient_user_id WHERE po.circle_id=? ORDER BY date DESC`).all(circleId,circleId);
  const payouts=db.prepare('SELECT p.id,p.amount,p.cycle_number,p.status,p.paid_at,p.created_at,u.name AS recipient_name FROM payouts p JOIN users u ON u.id=p.recipient_user_id WHERE p.circle_id=? ORDER BY p.cycle_number DESC').all(circleId);
  const payoutCollected=(db.prepare("SELECT COALESCE(SUM(co.amount),0) AS total FROM contributions co JOIN memberships m ON m.id=co.membership_id WHERE m.circle_id=? AND co.status='successful'").get(circleId) as {total:number}).total;
  const payoutAllocated=(db.prepare("SELECT COALESCE(SUM(amount),0) AS total FROM payouts WHERE circle_id=? AND status IN ('pending','successful')").get(circleId) as {total:number}).total;
  const counts={paid:members.filter(m=>m.status==='paid').length,pending:members.filter(m=>m.timingStatus==='upcoming'||m.timingStatus==='due_today').length,upcoming:members.filter(m=>m.timingStatus==='upcoming').length,dueToday:members.filter(m=>m.timingStatus==='due_today').length,partiallyPaid:members.filter(m=>m.status==='partially_paid').length,failed:members.filter(m=>m.has_failed).length,overdue:members.filter(m=>m.timingStatus==='overdue').length};
  return res.json({circle,round:round??null,period:{value:periodValue},businessDate:today(),businessTimeZone:'Asia/Kolkata',summary:{memberCount:members.length,expectedAmount,collectedAmount,outstandingAmount:Math.max(0,expectedAmount-collectedAmount),collectionPercent:expectedAmount?Math.min(100,Math.round(collectedAmount/expectedAmount*100)):0,statusCounts:counts},memberOptions:roundMembers.map(m=>({id:m.user_id,name:m.name})),members:visibleMembers,contributions,payments,payouts,payoutReadiness:{collected:payoutCollected,allocated:payoutAllocated,available:Math.max(0,payoutCollected-payoutAllocated)},report:{averageConsistencyPercent:visibleMembers.length?Math.round(visibleMembers.reduce((sum,m)=>sum+m.consistencyPercent,0)/visibleMembers.length):0,consistentMembers:visibleMembers.filter(m=>m.status==='paid').length},requests:{available:false,message:'Requests and voting are not configured for this demo.'}});
});

router.patch('/circles/:circleId/schedule',requireManagedCircle,(req,res)=>{
  const circleId=String(req.params.circleId);const current=db.prepare('SELECT contribution_amount,due_day FROM circles WHERE id=?').get(circleId) as {contribution_amount:number;due_day:number};
  const amount=req.body?.contributionAmount??current.contribution_amount,dueDay=req.body?.dueDay??current.due_day;
  if(!positive(amount)||!Number.isInteger(dueDay)||dueDay<1||dueDay>28)return res.status(400).json({error:'Provide a positive monthly target and a due day from 1 to 28.'});
  db.exec('BEGIN IMMEDIATE');try{
    db.prepare('UPDATE circles SET contribution_amount=?,frequency=\'monthly\',due_day=? WHERE id=?').run(amount,dueDay,circleId);
    db.prepare('INSERT INTO audit_history(entity_type,entity_id,action,details) VALUES(?,?,?,?)').run('circle',circleId,'schedule_updated',`Next-round monthly target changed to ${amount}, due day ${dueDay}. Existing round snapshots are unchanged.`);
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');return res.status(500).json({error:'Future schedule could not be saved.'});}
  return res.json(db.prepare('SELECT id,name,contribution_amount,frequency,due_day,cycle_count FROM circles WHERE id=?').get(circleId));
});

router.post('/circles/:circleId/payouts',requireManagedCircle,(req,res)=>{
  const circleId=String(req.params.circleId);const {recipientUserId,amount,cycleNumber}=req.body??{};
  if(typeof recipientUserId!=='string'||!positive(amount)||!positive(cycleNumber))return res.status(400).json({error:'recipientUserId, positive amount, and positive cycleNumber are required.'});
  if(!db.prepare("SELECT 1 FROM memberships WHERE circle_id=? AND user_id=? AND status='active'").get(circleId,recipientUserId))return res.status(400).json({error:'Payout recipient must be an active member of this circle.'});
  try{
    db.exec('BEGIN IMMEDIATE');
    const collected=(db.prepare("SELECT COALESCE(SUM(co.amount),0) AS total FROM contributions co JOIN memberships m ON m.id=co.membership_id WHERE m.circle_id=? AND co.status='successful'").get(circleId) as {total:number}).total;
    const allocated=(db.prepare("SELECT COALESCE(SUM(amount),0) AS total FROM payouts WHERE circle_id=? AND status IN ('pending','successful')").get(circleId) as {total:number}).total;
    if(amount>collected-allocated){db.exec('ROLLBACK');return res.status(409).json({error:'Payout request exceeds collected funds not already allocated.'});}
    const id=randomUUID();db.prepare("INSERT INTO payouts(id,circle_id,recipient_user_id,amount,cycle_number,status) VALUES(?,?,?,?,?,'pending')").run(id,circleId,recipientUserId,amount,cycleNumber);db.prepare('INSERT INTO audit_history(entity_type,entity_id,action,new_status,details) VALUES(?,?,?,?,?)').run('payout',id,'recorded','pending','Payout request recorded; provider confirmation is required before success.');db.exec('COMMIT');return res.status(201).json({payout:db.prepare('SELECT id,circle_id,recipient_user_id,amount,cycle_number,status,created_at FROM payouts WHERE id=?').get(id),simulated:true});
  }catch{try{db.exec('ROLLBACK')}catch{}return res.status(409).json({error:'Payout request conflicts with an existing cycle or could not be recorded.'});}
});
router.get('/circles/:circleId/payouts',requireManagedCircle,(req,res)=>res.json({payouts:db.prepare('SELECT p.id,p.amount,p.cycle_number,p.status,p.paid_at,p.created_at,u.name AS recipient_name FROM payouts p JOIN users u ON u.id=p.recipient_user_id WHERE p.circle_id=? ORDER BY p.cycle_number DESC').all(String(req.params.circleId)),simulated:true}));

export default router;
