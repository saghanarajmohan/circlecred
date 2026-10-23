import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { config } from '../config/env';
import { saveReliabilityScore } from './scoring';

export interface PaymentProvider {
  name: string;
  settle(): Promise<{ status: 'successful' | 'failed'; reference: string }>;
}

export const simulatedProvider: PaymentProvider = {
  name: 'simulated',
  async settle() {
    return { status: config.simulatedPaymentOutcome, reference: `SIM-${randomUUID()}` };
  },
};

export function createPayment(db: DatabaseSync, input: { membershipId: string; amount: number; dueDate: string; idempotencyKey: string; roundMemberId?: string }) {
  const existing = db.prepare('SELECT p.*,co.round_member_id FROM payments p LEFT JOIN contributions co ON co.id=p.contribution_id WHERE p.idempotency_key=?').get(input.idempotencyKey) as {id:string;membership_id:string;amount:number;round_member_id:string|null}|undefined;
  if (existing) {
    if(existing.membership_id!==input.membershipId||existing.amount!==input.amount||existing.round_member_id!==(input.roundMemberId??null))throw new Error('Idempotency key is already used for another contribution.');
    return { payment: existing, duplicate: true };
  }
  const membership = db.prepare("SELECT m.id,c.contribution_amount FROM memberships m JOIN circles c ON c.id=m.circle_id WHERE m.id=? AND m.status='active'").get(input.membershipId) as {id:string;contribution_amount:number}|undefined;
  if (!membership) throw new Error('Active membership not found');
  db.exec('BEGIN IMMEDIATE');
  try {
    let roundMemberId: string | null = null;
    if (input.roundMemberId) {
      const obligation = db.prepare(`SELECT rm.id,rm.membership_id,rm.target_amount,rm.deadline,r.status,
        COALESCE((SELECT SUM(co.amount) FROM contributions co WHERE co.round_member_id=rm.id AND co.status='successful'),0) AS paid
        FROM round_members rm JOIN contribution_rounds r ON r.id=rm.round_id WHERE rm.id=?`).get(input.roundMemberId) as {id:string;membership_id:string;target_amount:number;deadline:string;status:string;paid:number}|undefined;
      if (!obligation || obligation.membership_id !== input.membershipId) throw new Error('Monthly contribution target not found.');
      if (obligation.status !== 'open') throw new Error('This monthly round is closed.');
      if (input.dueDate !== obligation.deadline) throw new Error('Payment deadline must match the monthly round.');
      if (obligation.paid + input.amount > obligation.target_amount) throw new Error('Payment exceeds the remaining monthly target.');
      roundMemberId = obligation.id;
    } else {
      if(input.amount!==membership.contribution_amount)throw new Error('Contribution amount must match the circle schedule.');
    }
    const contributionId = randomUUID();
    const paymentId = randomUUID();
    db.prepare('INSERT INTO contributions (id,membership_id,amount,due_date,status,round_member_id) VALUES (?,?,?,?,?,?)').run(contributionId, input.membershipId, input.amount, input.dueDate, 'pending', roundMemberId);
    db.prepare('INSERT INTO payments (id,idempotency_key,contribution_id,membership_id,amount,status,provider) VALUES (?,?,?,?,?,?,?)').run(paymentId, input.idempotencyKey, contributionId, input.membershipId, input.amount, 'pending', 'simulated');
    db.prepare('UPDATE contributions SET payment_id=? WHERE id=?').run(paymentId, contributionId);
    db.prepare('INSERT INTO audit_history (entity_type,entity_id,action,new_status,details) VALUES (?,?,?,?,?)').run('payment', paymentId, 'created', 'pending', 'Simulated payment attempt created.');
    db.exec('COMMIT');
    return { payment: db.prepare('SELECT * FROM payments WHERE id=?').get(paymentId), duplicate: false };
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export async function settlePayment(db: DatabaseSync, paymentId: string, provider: PaymentProvider = simulatedProvider) {
  const payment = db.prepare('SELECT * FROM payments WHERE id=?').get(paymentId) as { id: string; status: string; contribution_id: string; membership_id: string } | undefined;
  if (!payment) throw new Error('Payment not found');
  if (payment.status !== 'pending') return { payment, duplicate: true };
  const outcome = await provider.settle();
  db.exec('BEGIN IMMEDIATE');
  try {
    const current = db.prepare('SELECT * FROM payments WHERE id=?').get(paymentId) as typeof payment;
    if (!current || current.status !== 'pending') { db.exec('COMMIT'); return { payment: current, duplicate: true }; }
    db.prepare('UPDATE payments SET status=?,provider_reference=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(outcome.status, outcome.reference, paymentId);
    db.prepare("UPDATE contributions SET status=?,paid_at=CASE WHEN ?='successful' THEN CURRENT_TIMESTAMP ELSE NULL END WHERE id=?").run(outcome.status, outcome.status, current.contribution_id);
    db.prepare('INSERT INTO audit_history (entity_type,entity_id,action,old_status,new_status,details) VALUES (?,?,?,?,?,?)').run('payment', paymentId, 'status_changed', 'pending', outcome.status, `Provider: ${provider.name}; reference: ${outcome.reference}`);
    if (outcome.status === 'successful') saveReliabilityScore(db, current.membership_id);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return { payment: db.prepare('SELECT * FROM payments WHERE id=?').get(paymentId), duplicate: false };
}
