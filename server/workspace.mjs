import { z } from 'zod';
import { transaction } from './db.mjs';

export class AppError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const id = z.uuid();
const name = z.string().trim().min(1).max(200);
const rate = z.number().finite().min(0).max(9999999999.99).multipleOf(0.01).nullable();
const customerInput = z.object({ name, rate, active: z.boolean() }).strict();
const projectInput = customerInput.extend({ customerId: id });
const entryInput = z.object({
  projectId: id,
  date: z.iso.date(),
  minutes: z.number().int().min(1).max(1440),
  description: z.string().trim().min(1).max(4000),
}).strict();
const versionInput = z.object({ version: z.number().int().positive() }).strict();
const entryUpdate = entryInput.extend({ version: z.number().int().positive() });
const batchInput = z.object({
  entryIds: z.array(id).min(1).max(1000).refine(ids => new Set(ids).size === ids.length, 'Entry IDs must be unique'),
  externalInvoiceReference: z.string().trim().max(200).optional(),
}).strict();
const customerSelect = 'id, name, rate::float8 AS rate, active';
const projectSelect = 'id, customer_id AS "customerId", name, rate::float8 AS rate, active';
const entrySelect = `e.id, e.project_id AS "projectId", e.date::text, e.minutes, e.description, e.status,
  e.created_by AS actor, e.version, e.billing_batch_id AS "billingBatchId", b.external_invoice_reference AS invoice`;
async function one(db, table, recordId) {
  id.parse(recordId);
  const { rows } = await db.query(`SELECT * FROM ${table} WHERE id = $1 FOR UPDATE`, [recordId]);
  if (!rows[0]) throw new AppError(404, 'Record not found.');
  return rows[0];
}
async function audit(db, actor, action, detail, entityType, entityId, customerId, projectId, before, after) {
  await db.query(`INSERT INTO audit_log(actor,action,detail,entity_type,entity_id,customer_id,project_id,before_data,after_data)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [actor,action,detail,entityType,entityId,customerId ?? null,projectId ?? null,before ?? null,after ?? null]);
}
async function activeProject(db, projectId, allowArchived = false) {
  const { rows } = await db.query(`SELECT p.*, c.active AS customer_active FROM projects p JOIN customers c ON c.id=p.customer_id WHERE p.id=$1 FOR SHARE OF p,c`, [projectId]);
  const project = rows[0];
  if (!project) throw new AppError(400, 'Choose an existing project.');
  if (!allowArchived && (!project.active || !project.customer_active)) throw new AppError(409, 'Choose an active customer and project.');
  return project;
}
export async function readWorkspace(pool) {
  return transaction(pool, async db => {
    const customers = (await db.query(`SELECT ${customerSelect} FROM customers ORDER BY created_at,id`)).rows;
    const projects = (await db.query(`SELECT ${projectSelect} FROM projects ORDER BY created_at,id`)).rows;
    const entries = (await db.query(`SELECT ${entrySelect} FROM time_entries e LEFT JOIN billing_batches b ON b.id=e.billing_batch_id ORDER BY e.date DESC,e.created_at DESC,e.id`)).rows;
    const history = (await db.query(`SELECT id,at,actor,action,detail,customer_id AS "customerId",project_id AS "projectId" FROM audit_log ORDER BY at DESC,id DESC`)).rows;
    return { customers,projects,entries,history };
  }, 'ISOLATION LEVEL REPEATABLE READ READ ONLY');
}
export async function saveRecord(pool, kind, recordId, input, actor) {
  const isProject = kind === 'projects';
  const schema = isProject ? projectInput : customerInput;
  const data = (recordId ? schema.partial() : schema.extend({ rate: rate.default(null), active: z.boolean().default(true) })).parse(input);
  if (!Object.keys(data).length) throw new AppError(400, 'Supply a change.');
  return transaction(pool, async db => {
    const before = recordId ? await one(db,kind,recordId) : null;
    const merged = { name: before?.name, rate: before?.rate == null ? null : Number(before.rate), active: before?.active, customerId: before?.customer_id, ...data };
    if (isProject) {
      if (before && merged.customerId !== before.customer_id) throw new AppError(409, 'A project cannot move to another customer.');
      const { rows } = await db.query('SELECT active FROM customers WHERE id=$1 FOR SHARE', [merged.customerId]);
      if (!rows[0]) throw new AppError(400,'Choose an existing customer.');
      if (!before && !rows[0].active) throw new AppError(409,'Choose an active customer.');
    }
    const values = [merged.name,merged.rate,merged.active];
    let result;
    if (recordId) {
      result = await db.query(`UPDATE ${kind} SET name=$1,rate=$2,active=$3,updated_at=now() WHERE id=$4 RETURNING *`, [...values,recordId]);
    } else {
      result = isProject
        ? await db.query('INSERT INTO projects(name,rate,active,customer_id) VALUES($1,$2,$3,$4) RETURNING *',[...values,merged.customerId])
        : await db.query('INSERT INTO customers(name,rate,active) VALUES($1,$2,$3) RETURNING *',values);
    }
    const after = result.rows[0];
    const verb = !before ? 'Created' : before.active !== after.active ? after.active ? 'Restored' : 'Archived' : 'Updated';
    await audit(db,actor,`${verb} ${isProject ? 'project' : 'customer'}`,after.name,isProject ? 'project' : 'customer',after.id,isProject ? after.customer_id : after.id,isProject ? after.id : null,before,after);
    return { id: after.id };
  });
}
async function createEntry(db, data, actor) {
  const project = await activeProject(db,data.projectId);
  const { rows: [after] } = await db.query('INSERT INTO time_entries(project_id,date,minutes,description,created_by) VALUES($1,$2,$3,$4,$5) RETURNING *',[data.projectId,data.date,data.minutes,data.description,actor]);
  await audit(db,actor,'Created time entry',`${data.minutes}m · ${data.description}`,'time_entry',after.id,project.customer_id,project.id,null,after);
  return { id: after.id };
}
export async function logTime(pool, input, actor) {
  const data = entryInput.parse(input);
  return transaction(pool, db => createEntry(db,data,actor));
}
export async function logTimeBulk(pool, input, actor) {
  const { entries } = z.object({entries:z.array(entryInput).min(1).max(1000)}).strict().parse(input);
  return transaction(pool, async db => {
    const result = [];
    for (const data of entries) result.push(await createEntry(db,data,actor));
    return result;
  });
}
export async function changeTime(pool, recordId, input, actor, voiding = false) {
  const data = (voiding ? versionInput : entryUpdate).parse(input);
  return transaction(pool, async db => {
    const before = await one(db,'time_entries',recordId);
    if (before.status !== 'unbilled') throw new AppError(409,'Billed and voided entries are read-only.');
    if (before.version !== data.version) throw new AppError(409,'This entry changed. Reload the page before editing again.');
    const project = await activeProject(db,voiding ? before.project_id : data.projectId,voiding || before.project_id === data.projectId);
    const { rows: [after] } = voiding
      ? await db.query("UPDATE time_entries SET status='void',version=version+1,updated_at=now() WHERE id=$1 RETURNING *",[recordId])
      : await db.query('UPDATE time_entries SET project_id=$1,date=$2,minutes=$3,description=$4,version=version+1,updated_at=now() WHERE id=$5 RETURNING *',[data.projectId,data.date,data.minutes,data.description,recordId]);
    await audit(db,actor,voiding ? 'Voided time entry' : 'Updated time entry',`${before.minutes}m → ${after.minutes}m · ${after.description}`,'time_entry',recordId,project.customer_id,project.id,before,after);
    return { id: recordId };
  });
}
export async function markEntriesBilled(pool, input, actor) {
  const data = batchInput.parse(input);
  return transaction(pool, async db => {
    const { rows } = await db.query(`SELECT e.*,p.customer_id FROM time_entries e JOIN projects p ON p.id=e.project_id WHERE e.id=ANY($1::uuid[]) ORDER BY e.id FOR UPDATE OF e`,[data.entryIds]);
    if (rows.length !== data.entryIds.length || rows.some(e => e.status !== 'unbilled')) throw new AppError(409,'All selected entries must still be unbilled.');
    const customerId = rows[0].customer_id;
    if (rows.some(e => e.customer_id !== customerId)) throw new AppError(400,'A billing batch must belong to one customer.');
    const totalMinutes = rows.reduce((sum,e) => sum+e.minutes,0);
    const { rows: [batch] } = await db.query('INSERT INTO billing_batches(customer_id,external_invoice_reference,total_minutes,created_by) VALUES($1,$2,$3,$4) RETURNING *',[customerId,data.externalInvoiceReference || null,totalMinutes,actor]);
    for (const before of rows) {
      const { rows: [after] } = await db.query("UPDATE time_entries SET status='billed',billing_batch_id=$1,version=version+1,updated_at=now() WHERE id=$2 RETURNING *",[batch.id,before.id]);
      await audit(db,actor,'Marked time entry billed',`${before.minutes}m · ${before.description}`,'time_entry',before.id,customerId,before.project_id,before,after);
    }
    await audit(db,actor,'Recorded billing batch',`${rows.length} entries · ${totalMinutes}m${data.externalInvoiceReference ? ` · ${data.externalInvoiceReference}` : ''}`,'billing_batch',batch.id,customerId,null,null,batch);
    return { id: batch.id };
  });
}
