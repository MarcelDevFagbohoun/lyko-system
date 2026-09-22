'use strict';

/**
 * Écritures comptables — journal (lecture), saisie manuelle diverse et
 * extourne. Saisie manuelle et extourne sont 2 des 3 actions sensibles
 * désignées explicitement par l'utilisateur : exigent `comptabilite_avancee`,
 * écrivent dans `gl_audit_log` et notifient le DG (la 3e est la clôture
 * d'exercice, voir glFiscalYears.js). Aucune route de modification/suppression
 * directe : jamais construite, par choix — la seule correction possible est
 * l'extourne (glReversalService, déjà appliqué comme filet de sécurité côté
 * service, imposé ici aussi côté route).
 */

const { Router } = require('express');
const { pool } = require('../../config/db');
const { ApiError } = require('../../middleware/error');
const { requireAuth, requirePermission } = require('../../middleware/auth');
const { createManualEntrySchema, extourneSchema } = require('../../validators/gl/entries');
const { resolveOpenFiscalYear } = require('../../services/gl/glPostingService');
const { extourneEcriture } = require('../../services/gl/glReversalService');
const { nextEntryNumber } = require('../../services/gl/glNumbering');
const { logGlAudit } = require('../../services/gl/glAuditService');
const { notifyDg } = require('../../services/gl/glNotificationService');
const { toActor } = require('../../utils/actor');
const logger = require('../../utils/logger');

const router = Router();
router.use(requireAuth);
const canAdvanced = requirePermission('comptabilite_avancee');

// mysql2 renvoie une colonne DATE comme un objet Date JS, sérialisé en JSON
// avec l'heure (ex. "2026-03-10T00:00:00.000Z") — jamais souhaité pour une
// date SANS heure ; voir le même besoin dans routes/accounting.js `isoDate`.
function isoDate(d) {
  if (!d) return null;
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}

function toPublicEntry(row) {
  return {
    id: row.id,
    entryNumber: row.entry_number,
    pieceNumber: row.piece_number,
    entryDate: isoDate(row.entry_date),
    narration: row.narration,
    journal: { code: row.journal_code, label: row.journal_label },
    sourceOperationType: row.source_operation_type,
    sourceTable: row.source_table,
    sourceId: row.source_id,
    status: row.status,
    reversesEntryId: row.reverses_entry_id,
    reversedByEntryId: row.reversed_by_entry_id,
    createdBy: toActor(row.creator_first_name, row.creator_last_name, row.creator_role),
    createdAt: row.created_at,
  };
}

// GET /api/gl/entries?from=&to=&journalId=&status= — journal des écritures.
router.get('/', canAdvanced, async (req, res, next) => {
  try {
    const params = { tenantId: req.user.tenantId };
    let where = 'e.tenant_id = :tenantId';

    const from = typeof req.query.from === 'string' ? req.query.from : '';
    const to = typeof req.query.to === 'string' ? req.query.to : '';
    if (from) { where += ' AND e.entry_date >= :from'; params.from = from; }
    if (to) { where += ' AND e.entry_date <= :to'; params.to = to; }

    const journalId = Number(req.query.journalId);
    if (Number.isInteger(journalId) && journalId > 0) { where += ' AND e.journal_id = :journalId'; params.journalId = journalId; }

    const status = typeof req.query.status === 'string' ? req.query.status : '';
    if (['brouillon', 'validee', 'extournee'].includes(status)) { where += ' AND e.status = :status'; params.status = status; }

    // Plafond défensif (pas de pagination réelle en V1) : sans `from`/`to`,
    // le journal d'un tenant actif depuis des années croîtrait sans borne à
    // chaque chargement de l'onglet — les 500 plus récentes couvrent
    // largement un usage courant (le grand livre par compte reste le bon
    // outil pour une recherche exhaustive/historique).
    const [rows] = await pool.query(
      `SELECT e.*, j.code AS journal_code, j.label AS journal_label,
              u.first_name AS creator_first_name, u.last_name AS creator_last_name, u.role AS creator_role
       FROM gl_entries e
       JOIN gl_journals j ON j.id = e.journal_id
       LEFT JOIN users u ON u.id = e.created_by
       WHERE ${where}
       ORDER BY e.entry_number DESC
       LIMIT 500`,
      params,
    );
    res.json({ entries: rows.map(toPublicEntry) });
  } catch (err) {
    next(err);
  }
});

// GET /api/gl/entries/:id — détail d'une écriture avec ses lignes.
router.get('/:id', canAdvanced, async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));

  try {
    const [rows] = await pool.query(
      `SELECT e.*, j.code AS journal_code, j.label AS journal_label,
              u.first_name AS creator_first_name, u.last_name AS creator_last_name, u.role AS creator_role
       FROM gl_entries e
       JOIN gl_journals j ON j.id = e.journal_id
       LEFT JOIN users u ON u.id = e.created_by
       WHERE e.id = :id AND e.tenant_id = :tenantId LIMIT 1`,
      { id, tenantId: req.user.tenantId },
    );
    if (!rows[0]) throw new ApiError(404, 'Écriture introuvable');

    const [lines] = await pool.query(
      `SELECT el.*, a.code AS account_code, a.label AS account_label, tp.display_name AS third_party_name, tp.auxiliary_code
       FROM gl_entry_lines el
       JOIN gl_accounts a ON a.id = el.account_id
       LEFT JOIN gl_third_parties tp ON tp.id = el.third_party_id
       WHERE el.entry_id = :id ORDER BY el.line_order ASC`,
      { id },
    );

    res.json({
      entry: toPublicEntry(rows[0]),
      lines: lines.map((l) => ({
        side: l.side,
        amount: Number(l.amount),
        accountCode: l.account_code,
        accountLabel: l.account_label,
        thirdParty: l.third_party_id ? { name: l.third_party_name, auxiliaryCode: l.auxiliary_code } : null,
        paymentMethod: l.payment_method,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/gl/entries/manual — saisie manuelle d'une écriture diverse.
// Toujours "validee" (jamais de brouillon en V1) : équilibre revérifié
// côté serveur (jamais fait confiance au total envoyé par le client), comptes
// et tiers vérifiés comme appartenant à ce tenant avant insertion.
router.post('/manual', canAdvanced, async (req, res, next) => {
  const parsed = createManualEntrySchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const { journalId, entryDate, narration, lines } = parsed.data;

  const conn = await pool.getConnection();
  try {
    const totalDebit = lines.filter((l) => l.side === 'debit').reduce((s, l) => s + l.amount, 0);
    const totalCredit = lines.filter((l) => l.side === 'credit').reduce((s, l) => s + l.amount, 0);
    if (totalDebit !== totalCredit) {
      throw new ApiError(400, `Écriture déséquilibrée : débit ${totalDebit} ≠ crédit ${totalCredit} FCFA`);
    }

    const [journalRows] = await conn.query('SELECT id FROM gl_journals WHERE id = :id AND tenant_id = :tenantId LIMIT 1', {
      id: journalId,
      tenantId: req.user.tenantId,
    });
    if (!journalRows[0]) throw new ApiError(404, 'Journal introuvable');

    const accountIds = [...new Set(lines.map((l) => l.accountId))];
    const [accountRows] = await conn.query(
      'SELECT id, is_control_account FROM gl_accounts WHERE id IN (:ids) AND tenant_id = :tenantId',
      { ids: accountIds, tenantId: req.user.tenantId },
    );
    const accountsById = new Map(accountRows.map((a) => [a.id, a]));
    for (const line of lines) {
      const account = accountsById.get(line.accountId);
      if (!account) throw new ApiError(404, `Compte introuvable (id ${line.accountId})`);
      if (account.is_control_account && !line.thirdPartyId) {
        throw new ApiError(400, `Un tiers est requis pour la ligne sur le compte collectif (id ${line.accountId})`);
      }
    }

    const thirdPartyIds = [...new Set(lines.map((l) => l.thirdPartyId).filter(Boolean))];
    if (thirdPartyIds.length > 0) {
      const [tpRows] = await conn.query('SELECT id FROM gl_third_parties WHERE id IN (:ids) AND tenant_id = :tenantId', {
        ids: thirdPartyIds,
        tenantId: req.user.tenantId,
      });
      const validTpIds = new Set(tpRows.map((t) => t.id));
      for (const line of lines) {
        if (line.thirdPartyId && !validTpIds.has(line.thirdPartyId)) {
          throw new ApiError(404, `Tiers introuvable (id ${line.thirdPartyId})`);
        }
      }
    }

    await conn.beginTransaction();

    const fiscalYearId = await resolveOpenFiscalYear(conn, req.user.tenantId, entryDate);
    const entryNumber = await nextEntryNumber(conn, req.user.tenantId);

    const [entryResult] = await conn.query(
      `INSERT INTO gl_entries (tenant_id, journal_id, fiscal_year_id, entry_number, piece_number, entry_date, narration, status, created_by)
       VALUES (:tenantId, :journalId, :fiscalYearId, :entryNumber, :entryNumber, :entryDate, :narration, 'validee', :by)`,
      { tenantId: req.user.tenantId, journalId, fiscalYearId, entryNumber, entryDate, narration, by: req.user.id },
    );
    const entryId = entryResult.insertId;

    for (const [i, line] of lines.entries()) {
      await conn.query(
        `INSERT INTO gl_entry_lines (entry_id, line_order, account_id, third_party_id, side, amount)
         VALUES (:entryId, :order, :accountId, :thirdPartyId, :side, :amount)`,
        { entryId, order: i + 1, accountId: line.accountId, thirdPartyId: line.thirdPartyId ?? null, side: line.side, amount: line.amount },
      );
    }

    await logGlAudit(conn, {
      tenantId: req.user.tenantId,
      userId: req.user.id,
      ipAddress: req.ip,
      action: 'manual_entry',
      entityTable: 'gl_entries',
      entityId: entryId,
      after: { entryNumber, entryDate, narration, lines },
    });
    await notifyDg(conn, {
      tenantId: req.user.tenantId,
      type: 'manual_entry',
      message: `Écriture manuelle n°${entryNumber} saisie (${narration})`,
      entityTable: 'gl_entries',
      entityId: entryId,
    });

    await conn.commit();
    logger.info('Écriture manuelle saisie', { tenantId: req.user.tenantId, entryId, entryNumber, by: req.user.id });
    res.status(201).json({ entryId, entryNumber });
  } catch (err) {
    await conn.rollback().catch(() => {});
    next(err);
  } finally {
    conn.release();
  }
});

// POST /api/gl/entries/:id/extourne — contre-passation, seule correction
// possible d'une écriture validée.
router.post('/:id/extourne', canAdvanced, async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = extourneSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const { entryDate, reason } = parsed.data;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await extourneEcriture(conn, {
      tenantId: req.user.tenantId,
      entryId: id,
      entryDate,
      userId: req.user.id,
      reason,
    });

    await logGlAudit(conn, {
      tenantId: req.user.tenantId,
      userId: req.user.id,
      ipAddress: req.ip,
      action: 'entry_reversed',
      entityTable: 'gl_entries',
      entityId: id,
      after: { reversalId: result.reversalId, reason },
    });
    await notifyDg(conn, {
      tenantId: req.user.tenantId,
      type: 'entry_reversed',
      message: `Écriture n°${id} extournée (${reason})`,
      entityTable: 'gl_entries',
      entityId: id,
    });

    await conn.commit();
    logger.info('Écriture extournée', { tenantId: req.user.tenantId, entryId: id, reversalId: result.reversalId, by: req.user.id });
    res.status(201).json(result);
  } catch (err) {
    await conn.rollback().catch(() => {});
    next(err);
  } finally {
    conn.release();
  }
});

module.exports = router;
