import type { DatabaseSync } from 'node:sqlite';
import type { ScoreFactor } from '../types';
import { businessDate, parseStoredTimestamp } from './businessDate';

export function calculateReliabilityScore(db: DatabaseSync, membershipId: string) {
  const membership = db.prepare(`SELECT joined_at, status FROM memberships WHERE id = ?`).get(membershipId) as { joined_at: string; status: string } | undefined;
  if (!membership) throw new Error('Membership not found');
  const installments = db.prepare(`SELECT status, due_date, paid_at, round_member_id, amount FROM contributions WHERE membership_id = ?`).all(membershipId) as { status: string; due_date: string; paid_at: string | null; round_member_id: string | null; amount:number }[];
  const obligations = new Map<string,{status:string;due_date:string;paid_at:string|null;paid:number;target:number}>();
  let legacyIndex=0;
  for (const row of installments) {
    const key=row.round_member_id??`legacy:${legacyIndex++}`;
    const existing=obligations.get(key);
    const target = row.round_member_id ? (db.prepare('SELECT target_amount FROM round_members WHERE id=?').get(row.round_member_id) as {target_amount:number}|undefined)?.target_amount ?? row.amount : row.amount;
    if (existing) { existing.paid += row.status==='successful'?row.amount:0; if(row.paid_at&&(!existing.paid_at||row.paid_at<existing.paid_at))existing.paid_at=row.paid_at; }
    else obligations.set(key,{status:row.status,due_date:row.due_date,paid_at:row.paid_at,paid:row.status==='successful'?row.amount:0,target});
  }
  const rows=[...obligations.values()].map(row=>({...row,status:row.paid>=row.target?'successful':row.status==='successful'?'pending':row.status}));
  const paid = rows.filter(row => row.status === 'successful');
  const due = rows.filter(row => row.status !== 'pending' || row.due_date < businessDate());
  const onTimeRatio = paid.length ? paid.filter(row => row.paid_at && businessDate(parseStoredTimestamp(row.paid_at)) <= row.due_date).length / paid.length : 1;
  const consistency = due.length ? paid.length / due.length : 1;
  const delayedCount = rows.filter(row => row.status === 'delayed').length;
  const participationMonths = Math.min(12, Math.max(0, (Date.now() - Date.parse(membership.joined_at)) / (30 * 86400000)));
  const completedCycles = membership.status === 'completed' ? 1 : 0;
  const factors: ScoreFactor[] = [
    { key: 'on_time', label: 'On-time contributions', value: Math.round(onTimeRatio * 100), weight: 0.35, points: Math.round(onTimeRatio * 297.5), detail: `${paid.filter(r => r.paid_at && businessDate(parseStoredTimestamp(r.paid_at)) <= r.due_date).length} of ${paid.length} paid contributions were on time.` },
    { key: 'consistency', label: 'Contribution consistency', value: Math.round(consistency * 100), weight: 0.25, points: Math.round(consistency * 212.5), detail: `${paid.length} successful contributions across ${due.length} due records.` },
    { key: 'completed_cycles', label: 'Completed cycles', value: completedCycles, weight: 0.15, points: completedCycles ? 127 : 0, detail: completedCycles ? 'Membership has completed a cycle.' : 'No completed cycle recorded for this membership.' },
    { key: 'delays', label: 'Delayed payments', value: delayedCount, weight: 0.15, points: Math.round(Math.max(0, 1 - delayedCount / Math.max(1, rows.length)) * 127.5), detail: `${delayedCount} delayed contribution(s) recorded.` },
    { key: 'participation', label: 'Participation history', value: Math.round(participationMonths), weight: 0.10, points: Math.round(participationMonths / 12 * 85), detail: `${Math.round(participationMonths)} month(s) of participation, capped at 12.` },
  ];
  const score = Math.min(850, factors.reduce((sum, factor) => sum + factor.points, 0));
  return { score, maxScore: 850, factors, calculatedAt: new Date().toISOString(), disclaimer: 'An internal savings reliability indicator only. It is not an official credit score and does not guarantee loan approval.' };
}

export function saveReliabilityScore(db: DatabaseSync, membershipId: string) {
  const result = calculateReliabilityScore(db, membershipId);
  db.prepare('INSERT INTO reliability_scores (membership_id, score, factors_json) VALUES (?, ?, ?)').run(membershipId, result.score, JSON.stringify(result.factors));
  return result;
}
