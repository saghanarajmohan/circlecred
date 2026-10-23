import { randomUUID } from 'node:crypto';
import { getDatabase } from './database';
import { makePasswordHash } from './auth';
import { saveReliabilityScore } from './scoring';

function ensureDemoUser(user: {id:string;name:string;email:string;role:'member'|'circle_head';password:string}) {
  const db=getDatabase();
  db.prepare('INSERT OR IGNORE INTO users(id,name,email,role,password_hash) VALUES(?,?,?,?,?)').run(user.id,user.name,user.email,user.role,makePasswordHash(user.password));
  db.prepare('UPDATE users SET role=?,password_hash=COALESCE(password_hash,?) WHERE id=?').run(user.role,makePasswordHash(user.password),user.id);
}

function ensureContribution(input: {id:string;membershipId:string;amount:number;dueDate:string;status:'pending'|'successful'|'failed';paidAt?:string}) {
  const db=getDatabase();
  db.prepare('INSERT OR IGNORE INTO contributions(id,membership_id,amount,due_date,paid_at,status) VALUES(?,?,?,?,?,?)').run(input.id,input.membershipId,input.amount,input.dueDate,input.paidAt??null,input.status);
  const contribution=db.prepare('SELECT payment_id FROM contributions WHERE id=?').get(input.id) as {payment_id:string|null}|undefined;
  if(!contribution||contribution.payment_id||input.status==='pending')return;
  const paymentId=randomUUID();
  db.prepare('INSERT OR IGNORE INTO payments(id,idempotency_key,contribution_id,membership_id,amount,status,provider) VALUES(?,?,?,?,?,?,?)').run(paymentId,`demo-seed-${input.id}`,input.id,input.membershipId,input.amount,input.status,'simulated');
  db.prepare('UPDATE contributions SET payment_id=(SELECT id FROM payments WHERE idempotency_key=?) WHERE id=?').run(`demo-seed-${input.id}`,input.id);
  db.prepare('INSERT INTO audit_history(entity_type,entity_id,action,new_status,details) VALUES(?,?,?,?,?)').run('payment',paymentId,'seeded',input.status,'Seeded simulated payment outcome.');
}

export function seedDemoData() {
  const db=getDatabase();
  ensureDemoUser({id:'user-ananya',name:'Ananya Sharma',email:'ananya@example.test',role:'member',password:'member-demo'});
  ensureDemoUser({id:'user-nisha',name:'Nisha Verma',email:'nisha@example.test',role:'member',password:'member-demo'});
  ensureDemoUser({id:'user-dev',name:'Dev Patel',email:'dev@example.test',role:'member',password:'member-demo'});
  ensureDemoUser({id:'user-circle-head',name:'Maya Iyer',email:'head@circlecred.demo',role:'circle_head',password:'circlehead-demo'});
  const insertCircle=db.prepare('INSERT OR IGNORE INTO circles(id,name,contribution_amount,frequency,due_day,cycle_count) VALUES(?,?,?,?,?,?)');
  insertCircle.run('circle-women',"Women's Growth Circle",2000,'monthly',12,10);
  insertCircle.run('circle-community','Community Savers',1500,'monthly',12,8);
  db.prepare("UPDATE circles SET status='frozen',frozen_at=COALESCE(frozen_at,CURRENT_TIMESTAMP) WHERE id IN ('circle-women','circle-community')").run();
  const addMembership=db.prepare('INSERT OR IGNORE INTO memberships(id,user_id,circle_id,joined_at) VALUES(?,?,?,?)');
  addMembership.run('membership-women','user-ananya','circle-women','2025-10-01T00:00:00.000Z');
  addMembership.run('membership-community','user-ananya','circle-community','2026-02-01T00:00:00.000Z');
  addMembership.run('membership-women-nisha','user-nisha','circle-women','2026-01-01T00:00:00.000Z');
  addMembership.run('membership-women-dev','user-dev','circle-women','2026-03-01T00:00:00.000Z');
  db.prepare('INSERT OR IGNORE INTO circle_heads(user_id,circle_id) VALUES(?,?)').run('user-circle-head','circle-women');

  const date=new Date();
  const day=(n:number)=>`${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,'0')}-${String(n).padStart(2,'0')}`;
  const today=date.toISOString().slice(0,10);
  const yesterday=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate()-1)).toISOString().slice(0,10);
  const due=Math.min(12,new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate());
  ensureContribution({id:'contrib-1',membershipId:'membership-women',amount:2000,dueDate:day(due),paidAt:`${today}T10:00:00.000Z`,status:'successful'});
  ensureContribution({id:'contrib-2',membershipId:'membership-community',amount:2000,dueDate:'2026-09-12',paidAt:'2026-09-12T10:00:00.000Z',status:'successful'});
  ensureContribution({id:'contrib-3',membershipId:'membership-women',amount:2000,dueDate:'2026-09-05',paidAt:'2026-09-05T10:00:00.000Z',status:'successful'});
  ensureContribution({id:'contrib-4',membershipId:'membership-community',amount:2000,dueDate:'2026-08-12',paidAt:'2026-08-12T10:00:00.000Z',status:'successful'});
  ensureContribution({id:'contrib-pending-1',membershipId:'membership-women',amount:2000,dueDate:today,status:'pending'});
  ensureContribution({id:'contrib-nisha-current',membershipId:'membership-women-nisha',amount:2000,dueDate:day(due),paidAt:`${today}T10:00:00.000Z`,status:'successful'});
  ensureContribution({id:'contrib-dev-current',membershipId:'membership-women-dev',amount:2000,dueDate:day(due),status:'failed'});
  ensureContribution({id:'contrib-nisha-overdue',membershipId:'membership-women-nisha',amount:2000,dueDate:yesterday,status:'pending'});
  for(const membershipId of ['membership-women','membership-community','membership-women-nisha','membership-women-dev']) {
    if(!(db.prepare('SELECT 1 FROM reliability_scores WHERE membership_id=? LIMIT 1').get(membershipId)))saveReliabilityScore(db,membershipId);
  }
}
