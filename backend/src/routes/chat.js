'use strict';

/**
 * Discussion interne un-à-un (DG / comptable / agent d'une même entreprise).
 *  - Cloisonnement : tout est borné au tenant de la session ET aux deux participants de la conversation ;
 *    le DG n'a aucun accès aux conversations des autres.
 *  - Pièces jointes : stockées hors de `/api/files` (voir le garde-fou dans files.js) et servies uniquement
 *    aux deux participants, après contrôle du contenu réel (octets magiques).
 */
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { Router } = require('express');
const { pool } = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { ApiError } = require('../middleware/error');
const { detectFileType, randomFileName } = require('../utils/uploads');

const UPLOADS_ROOT = path.join(__dirname, '../../uploads');
const MAX_FILE = 10 * 1024 * 1024;
const MAX_BODY = 4000;
const PAGE = 50;

const MIME = {
  png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
const ROLE_LABEL = { dg: 'Directeur général', comptable: 'Comptable', agent: 'Agent' };

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE, files: 1 } });

const router = Router();
router.use(requireAuth);

const pair = (a, b) => (a < b ? [a, b] : [b, a]);

/** Type réel du fichier : octets magiques ; les formats Office (zip) sont validés par l'extension annoncée. */
function resolveType(file) {
  const real = detectFileType(file.buffer);
  if (real) return real;
  const ext = path.extname(file.originalname || '').slice(1).toLowerCase();
  const isZip = file.buffer.length > 4 && file.buffer[0] === 0x50 && file.buffer[1] === 0x4b;
  if (isZip && ['docx', 'xlsx', 'pptx'].includes(ext)) return ext;
  throw new ApiError(400, 'Pièce jointe : formats acceptés images (PNG, JPEG, WEBP), PDF, Word, Excel, PowerPoint (10 Mo max)');
}

function cleanName(original, ext) {
  let name = Buffer.from(original || '', 'latin1').toString('utf8');
  if (name.includes('�')) name = original || '';
  name = path.basename(name).replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_').trim().slice(0, 120);
  return name || `fichier.${ext}`;
}

async function peerOf(req, peerId) {
  const id = Number(peerId);
  if (!Number.isInteger(id) || id <= 0 || id === req.user.id) throw new ApiError(404, 'Collègue introuvable');
  const [rows] = await pool.query(
    "SELECT id, first_name, last_name, role, avatar_path FROM users WHERE id = :id AND tenant_id = :t AND status = 'active' LIMIT 1",
    { id, t: req.user.tenantId },
  );
  if (!rows[0]) throw new ApiError(404, 'Collègue introuvable');
  return rows[0];
}

async function findConversation(req, peerId) {
  const [a, b] = pair(req.user.id, peerId);
  const [rows] = await pool.query(
    'SELECT id FROM chat_conversations WHERE tenant_id = :t AND user_a = :a AND user_b = :b LIMIT 1',
    { t: req.user.tenantId, a, b },
  );
  return rows[0]?.id || null;
}

async function ensureConversation(req, peerId) {
  const [a, b] = pair(req.user.id, peerId);
  await pool.query('INSERT IGNORE INTO chat_conversations (tenant_id, user_a, user_b) VALUES (:t, :a, :b)', { t: req.user.tenantId, a, b });
  return findConversation(req, peerId);
}

function toMessage(row, meId) {
  const deleted = !!row.deleted_at;
  return {
    id: Number(row.id),
    senderId: row.sender_id,
    mine: row.sender_id === meId,
    body: deleted ? null : row.body,
    deleted,
    editedAt: !deleted && row.edited_at ? row.edited_at : null,
    createdAt: row.created_at,
    attachment: !deleted && row.attachment_path
      ? {
          name: row.attachment_name,
          mime: row.attachment_mime,
          size: row.attachment_size,
          isImage: row.attachment_mime.startsWith('image/'),
          url: `/api/chat/attachments/${row.id}`,
        }
      : null,
  };
}

function preview(row) {
  if (row.deleted_at) return 'Message supprimé';
  if (row.body) return row.body.slice(0, 120);
  if (row.attachment_mime?.startsWith('image/')) return '📷 Photo';
  return `📎 ${row.attachment_name || 'Document'}`;
}

// ---------- Liste : tous les collègues, ceux avec qui j'ai déjà écrit d'abord ----------
router.get('/conversations', async (req, res, next) => {
  try {
    const me = req.user.id;
    const t = req.user.tenantId;
    const [users] = await pool.query(
      "SELECT id, first_name, last_name, role, avatar_path FROM users WHERE tenant_id = :t AND status = 'active' AND id <> :me ORDER BY first_name, last_name",
      { t, me },
    );
    const [convs] = await pool.query(
      `SELECT IF(c.user_a = :me, c.user_b, c.user_a) AS peer_id, m.id, m.sender_id, m.body, m.attachment_name, m.attachment_mime,
              m.deleted_at, m.created_at,
              (SELECT COUNT(*) FROM chat_messages x WHERE x.conversation_id = c.id AND x.sender_id <> :me AND x.deleted_at IS NULL
                 AND x.id > COALESCE(r.last_read_message_id, 0)) AS unread,
              COALESCE(pr.last_read_message_id, 0) AS peer_read
         FROM chat_conversations c
         JOIN chat_messages m ON m.id = (SELECT MAX(id) FROM chat_messages WHERE conversation_id = c.id)
         LEFT JOIN chat_reads r ON r.conversation_id = c.id AND r.user_id = :me
         LEFT JOIN chat_reads pr ON pr.conversation_id = c.id AND pr.user_id = IF(c.user_a = :me, c.user_b, c.user_a)
        WHERE c.tenant_id = :t AND (c.user_a = :me OR c.user_b = :me)`,
      { t, me },
    );
    const byPeer = new Map(convs.map((c) => [c.peer_id, c]));
    const list = users.map((u) => {
      const c = byPeer.get(u.id);
      return {
        userId: u.id,
        name: `${u.first_name} ${u.last_name}`.trim(),
        role: u.role,
        roleLabel: ROLE_LABEL[u.role],
        avatarUrl: u.avatar_path ? `/api/files/${u.avatar_path}` : null,
        last: c
          ? { preview: preview(c), mine: c.sender_id === me, at: c.created_at, deleted: !!c.deleted_at, read: Number(c.id) <= Number(c.peer_read) }
          : null,
        unread: c ? Number(c.unread) : 0,
      };
    });
    list.sort((x, y) => {
      if (!!x.last !== !!y.last) return x.last ? -1 : 1;
      if (x.last && y.last) return new Date(y.last.at) - new Date(x.last.at);
      return x.name.localeCompare(y.name, 'fr');
    });
    res.json({ conversations: list, unreadTotal: list.reduce((s, c) => s + c.unread, 0) });
  } catch (err) { next(err); }
});

router.get('/unread-count', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT COUNT(*) AS n FROM chat_messages x
         JOIN chat_conversations c ON c.id = x.conversation_id
         LEFT JOIN chat_reads r ON r.conversation_id = c.id AND r.user_id = :me
        WHERE c.tenant_id = :t AND (c.user_a = :me OR c.user_b = :me) AND x.sender_id <> :me AND x.deleted_at IS NULL
          AND x.id > COALESCE(r.last_read_message_id, 0)`,
      { t: req.user.tenantId, me: req.user.id },
    );
    res.json({ count: Number(rows[0].n) });
  } catch (err) { next(err); }
});

// ---------- Messages d'une conversation (les 50 derniers, ou plus anciens via ?before=) ----------
router.get('/conversations/:peerId/messages', async (req, res, next) => {
  try {
    const peer = await peerOf(req, req.params.peerId);
    const convId = await findConversation(req, peer.id);
    const base = {
      peer: { userId: peer.id, name: `${peer.first_name} ${peer.last_name}`.trim(), roleLabel: ROLE_LABEL[peer.role], avatarUrl: peer.avatar_path ? `/api/files/${peer.avatar_path}` : null },
    };
    if (!convId) return res.json({ ...base, messages: [], peerLastReadId: 0, hasMore: false });

    const before = Number(req.query.before) || null;
    const [rows] = await pool.query(
      `SELECT * FROM chat_messages WHERE conversation_id = :c ${before ? 'AND id < :before' : ''} ORDER BY id DESC LIMIT ${PAGE + 1}`,
      { c: convId, before },
    );
    const hasMore = rows.length > PAGE;
    const page = rows.slice(0, PAGE).reverse();

    if (!before && req.query.markRead !== 'false' && page.length) {
      await pool.query(
        `INSERT INTO chat_reads (conversation_id, user_id, last_read_message_id) VALUES (:c, :me, :last)
         ON DUPLICATE KEY UPDATE last_read_message_id = GREATEST(last_read_message_id, VALUES(last_read_message_id))`,
        { c: convId, me: req.user.id, last: page[page.length - 1].id },
      );
    }
    const [pr] = await pool.query('SELECT last_read_message_id FROM chat_reads WHERE conversation_id = :c AND user_id = :p', { c: convId, p: peer.id });
    res.json({ ...base, messages: page.map((r) => toMessage(r, req.user.id)), peerLastReadId: Number(pr[0]?.last_read_message_id || 0), hasMore });
  } catch (err) { next(err); }
});

// ---------- Envoi (texte et/ou pièce jointe) ----------
router.post('/conversations/:peerId/messages', upload.single('file'), async (req, res, next) => {
  let savedAbs = null;
  try {
    const peer = await peerOf(req, req.params.peerId);
    const body = typeof req.body.body === 'string' ? req.body.body.trim() : '';
    if (body.length > MAX_BODY) throw new ApiError(400, `Message trop long (${MAX_BODY} caractères maximum)`);
    if (!body && !req.file) throw new ApiError(400, 'Message vide');

    let att = { path: null, name: null, mime: null, size: null };
    if (req.file) {
      const ext = resolveType(req.file);
      const rel = `tenants/${req.user.tenantId}/chat/${randomFileName('msg', ext)}`;
      savedAbs = path.join(UPLOADS_ROOT, rel);
      await fs.promises.mkdir(path.dirname(savedAbs), { recursive: true });
      await fs.promises.writeFile(savedAbs, req.file.buffer);
      att = { path: rel, name: cleanName(req.file.originalname, ext), mime: MIME[ext], size: req.file.size };
    }
    const convId = await ensureConversation(req, peer.id);
    const [ins] = await pool.query(
      `INSERT INTO chat_messages (tenant_id, conversation_id, sender_id, body, attachment_path, attachment_name, attachment_mime, attachment_size)
       VALUES (:t, :c, :me, :body, :p, :n, :m, :s)`,
      { t: req.user.tenantId, c: convId, me: req.user.id, body: body || null, p: att.path, n: att.name, m: att.mime, s: att.size },
    );
    // Écrire, c'est avoir lu jusque-là.
    await pool.query(
      `INSERT INTO chat_reads (conversation_id, user_id, last_read_message_id) VALUES (:c, :me, :id)
       ON DUPLICATE KEY UPDATE last_read_message_id = GREATEST(last_read_message_id, VALUES(last_read_message_id))`,
      { c: convId, me: req.user.id, id: ins.insertId },
    );
    const [rows] = await pool.query('SELECT * FROM chat_messages WHERE id = :id', { id: ins.insertId });
    res.status(201).json({ message: toMessage(rows[0], req.user.id) });
  } catch (err) {
    if (savedAbs) fs.promises.unlink(savedAbs).catch(() => {});
    next(err);
  }
});

async function ownMessage(req) {
  const id = Number(req.params.id);
  const [rows] = await pool.query(
    `SELECT m.* FROM chat_messages m JOIN chat_conversations c ON c.id = m.conversation_id
      WHERE m.id = :id AND c.tenant_id = :t AND (c.user_a = :me OR c.user_b = :me) LIMIT 1`,
    { id: Number.isInteger(id) ? id : 0, t: req.user.tenantId, me: req.user.id },
  );
  if (!rows[0]) throw new ApiError(404, 'Message introuvable');
  return rows[0];
}

// ---------- Modification (texte, par l'auteur) ----------
router.patch('/messages/:id', async (req, res, next) => {
  try {
    const msg = await ownMessage(req);
    if (msg.sender_id !== req.user.id) throw new ApiError(403, 'Vous ne pouvez modifier que vos propres messages');
    if (msg.deleted_at) throw new ApiError(409, 'Ce message a été supprimé');
    const body = typeof req.body.body === 'string' ? req.body.body.trim() : '';
    if (!body && !msg.attachment_path) throw new ApiError(400, 'Message vide');
    if (body.length > MAX_BODY) throw new ApiError(400, `Message trop long (${MAX_BODY} caractères maximum)`);
    await pool.query('UPDATE chat_messages SET body = :b, edited_at = UTC_TIMESTAMP() WHERE id = :id', { b: body || null, id: msg.id });
    const [rows] = await pool.query('SELECT * FROM chat_messages WHERE id = :id', { id: msg.id });
    res.json({ message: toMessage(rows[0], req.user.id) });
  } catch (err) { next(err); }
});

// ---------- Suppression (logique ; le fichier est effacé du disque) ----------
router.delete('/messages/:id', async (req, res, next) => {
  try {
    const msg = await ownMessage(req);
    if (msg.sender_id !== req.user.id) throw new ApiError(403, 'Vous ne pouvez supprimer que vos propres messages');
    if (!msg.deleted_at) {
      await pool.query(
        'UPDATE chat_messages SET deleted_at = UTC_TIMESTAMP(), body = NULL, attachment_path = NULL, attachment_name = NULL, attachment_mime = NULL, attachment_size = NULL WHERE id = :id',
        { id: msg.id },
      );
      if (msg.attachment_path) fs.promises.unlink(path.join(UPLOADS_ROOT, msg.attachment_path)).catch(() => {});
    }
    res.status(204).send();
  } catch (err) { next(err); }
});

// ---------- Pièce jointe : réservée aux deux participants ----------
router.get('/attachments/:id', async (req, res, next) => {
  try {
    const msg = await ownMessage(req);
    if (!msg.attachment_path || msg.deleted_at) throw new ApiError(404, 'Fichier introuvable');
    const download = req.query.download === '1' || !/^(image\/|application\/pdf)/.test(msg.attachment_mime);
    res.setHeader('Content-Type', msg.attachment_mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(msg.attachment_name)}`);
    res.sendFile(msg.attachment_path, { root: UPLOADS_ROOT }, (err) => {
      if (err && !res.headersSent) next(new ApiError(404, 'Fichier introuvable'));
    });
  } catch (err) { next(err); }
});

module.exports = router;
