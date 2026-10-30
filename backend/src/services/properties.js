'use strict';

/**
 * Biens (`properties`) et unités (`property_units`) : toutes les requêtes SQL de la route
 * `/api/properties` vivent ici (y compris l'écriture des photos du Bien). La route garde le HTTP.
 * Chaque fonction est isolée par `tenantId` et, pour un agent restreint, par `scopeAgentId`
 * (`null` = accès complet).
 */
const path = require('path');
const fs = require('fs/promises');
const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');
const { MAX_PHOTOS_PER_PROPERTY } = require('../constants/properties');
const { assertUploadType, randomFileName } = require('../utils/uploads');
const { assertWithinLimit } = require('./entitlements');

const UPLOADS_ROOT = path.join(__dirname, '../../uploads');

/**
 * Un même numéro de compteur SONEB/SBEE ne doit jamais être attribué à deux
 * Unités différentes de la même entreprise (compteur physique réel, un seul
 * possesseur) — voir migration 059 pour la contrainte UNIQUE en base ;
 * ce contrôle applicatif existe seulement pour renvoyer un message clair
 * (409) plutôt que le `ER_DUP_ENTRY` brut de MySQL. `excludeUnitId` (édition)
 * exclut l'unité elle-même de la recherche — resaisir sa propre valeur
 * inchangée ne doit jamais se déclarer en conflit avec soi-même.
 */
async function assertMeterNumbersAvailable(conn, tenantId, { sonebMeterNumber, sbeeMeterNumber }, excludeUnitId) {
  if (sonebMeterNumber) {
    const [rows] = await conn.query(
      `SELECT id FROM property_units WHERE tenant_id = :tenantId AND soneb_meter_number = :value
       ${excludeUnitId ? 'AND id != :excludeUnitId' : ''} LIMIT 1`,
      { tenantId, value: sonebMeterNumber, excludeUnitId },
    );
    if (rows[0]) throw new ApiError(409, 'Ce numéro de compteur SONEB est déjà utilisé par une autre unité');
  }
  if (sbeeMeterNumber) {
    const [rows] = await conn.query(
      `SELECT id FROM property_units WHERE tenant_id = :tenantId AND sbee_meter_number = :value
       ${excludeUnitId ? 'AND id != :excludeUnitId' : ''} LIMIT 1`,
      { tenantId, value: sbeeMeterNumber, excludeUnitId },
    );
    if (rows[0]) throw new ApiError(409, 'Ce numéro de compteur SBEE est déjà utilisé par une autre unité');
  }
}

// Bien + son propriétaire joint (nom/téléphone) + son créateur (nom/rôle) :
// réutilisé par la liste, la fiche et la création d'un Bien existant.
const PROPERTY_WITH_OWNER_SELECT = `
  p.*, o.name AS owner_name, o.phone AS owner_phone,
  cu.first_name AS creator_first_name, cu.last_name AS creator_last_name, cu.role AS creator_role,
  au.first_name AS agent_first_name, au.last_name AS agent_last_name
`;
const PROPERTY_WITH_OWNER_JOINS = `
  JOIN owners o ON o.id = p.owner_id
  LEFT JOIN users cu ON cu.id = p.created_by
  LEFT JOIN users au ON au.id = p.agent_id
`;

/**
 * Charge un Bien de l'entreprise courante (+ son propriétaire), ou lève 404.
 * `scopeAgentId` (voir services/scope.js) : si fourni (agent restreint à un
 * sous-ensemble du portefeuille), un Bien attribué à un AUTRE agent (ou à
 * personne) répond aussi 404 — jamais 403, pour ne jamais confirmer qu'un
 * Bien existe à un agent qui ne le gère pas.
 */
async function loadProperty(conn, tenantId, propertyId, scopeAgentId = null) {
  const [rows] = await conn.query(
    `SELECT ${PROPERTY_WITH_OWNER_SELECT} FROM properties p ${PROPERTY_WITH_OWNER_JOINS}
     WHERE p.id = :id AND p.tenant_id = :tenantId LIMIT 1`,
    { id: propertyId, tenantId },
  );
  if (!rows[0]) throw new ApiError(404, 'Bien introuvable');
  if (scopeAgentId != null && Number(rows[0].agent_id) !== Number(scopeAgentId)) {
    throw new ApiError(404, 'Bien introuvable');
  }
  return rows[0];
}

/** Vérifie que le propriétaire appartient à l'entreprise courante, ou lève 404. */
async function assertOwnerExists(conn, tenantId, ownerId) {
  const [rows] = await conn.query('SELECT id FROM owners WHERE id = :id AND tenant_id = :tenantId LIMIT 1', {
    id: ownerId,
    tenantId,
  });
  if (!rows[0]) throw new ApiError(404, 'Propriétaire introuvable');
}

async function nextPropertyCode(conn, tenantId) {
  const [rows] = await conn.query('SELECT COUNT(*) AS n FROM properties WHERE tenant_id = :tenantId', { tenantId });
  return `BIEN-${String(Number(rows[0].n) + 1).padStart(3, '0')}`;
}

async function nextUnitCode(conn, propertyCode, propertyId) {
  const [rows] = await conn.query('SELECT COUNT(*) AS n FROM property_units WHERE property_id = :propertyId', {
    propertyId,
  });
  return `${propertyCode}-U${String(Number(rows[0].n) + 1).padStart(2, '0')}`;
}

/** Biens (avec propriétaire, agent, nombre d'unités / unités libres) ; recherche par propriétaire ou code. */
async function listProperties(tenantId, scopeAgentId, q) {
  const params = { tenantId };
  let where = 'p.tenant_id = :tenantId';
  if (q) {
    where += ' AND (o.name LIKE :q OR p.code LIKE :q)';
    params.q = `%${q}%`;
  }
  // Portée « Biens gérés » (étape 14) : un agent restreint ne voit que ses propres Biens attribués.
  if (scopeAgentId != null) {
    where += ' AND p.agent_id = :scopeAgentId';
    params.scopeAgentId = scopeAgentId;
  }
  const [rows] = await pool.query(
    `SELECT ${PROPERTY_WITH_OWNER_SELECT},
            COUNT(u.id) AS units_count,
            SUM(CASE WHEN u.status = 'libre' THEN 1 ELSE 0 END) AS units_free
     FROM properties p
     ${PROPERTY_WITH_OWNER_JOINS}
     LEFT JOIN property_units u ON u.property_id = p.id
     WHERE ${where}
     GROUP BY p.id
     ORDER BY p.created_at DESC`,
    params,
  );
  return rows;
}

/** Unités d'un Bien avec locataire actuel et créateur. */
async function listPropertyUnits(propertyId) {
  const [units] = await pool.query(
    `SELECT u.*, l.id AS active_lease_id, r.id AS renter_id, r.first_name, r.last_name,
            cu.first_name AS creator_first_name, cu.last_name AS creator_last_name, cu.role AS creator_role
     FROM property_units u
     LEFT JOIN leases l ON l.unit_id = u.id AND l.status = 'active'
     LEFT JOIN renters r ON r.id = l.renter_id
     LEFT JOIN users cu ON cu.id = u.created_by
     WHERE u.property_id = :id
     ORDER BY u.code`,
    { id: propertyId },
  );
  return units;
}

/** Écrit les photos d'un Bien et renvoie leurs chemins relatifs. */
async function writePhotos(tenantId, propertyId, files, startIndex = 0) {
  const dir = path.join(UPLOADS_ROOT, `tenants/${tenantId}/properties/${propertyId}`);
  await fs.mkdir(dir, { recursive: true });
  return Promise.all(
    files.map(async (file, i) => {
      const ext = assertUploadType(file, { label: 'Photo' });
      const rel = `tenants/${tenantId}/properties/${propertyId}/${randomFileName(`photo-${startIndex + i + 1}`, ext)}`;
      await fs.writeFile(path.join(UPLOADS_ROOT, rel), file.buffer);
      return rel;
    }),
  );
}

/**
 * Crée un Bien (+ photos). Un agent déjà restreint à un sous-ensemble du portefeuille (étape 14) qui crée
 * un nouveau Bien doit pouvoir le retrouver ensuite : auto-attribution à lui-même (`scopeAgentId`) ; le DG
 * (ou un agent en accès complet) crée toujours un Bien non attribué.
 */
async function createProperty(tenantId, userId, scopeAgentId, data, files) {
  const conn = await pool.getConnection();
  try {
    await assertOwnerExists(conn, tenantId, data.ownerId);
    await conn.beginTransaction();

    const code = await nextPropertyCode(conn, tenantId);
    const hasCoords = data.latitude != null && data.longitude != null;
    const [result] = await conn.query(
      `INSERT INTO properties
         (tenant_id, code, owner_id, agent_id, agent_assigned_at, address, latitude, longitude, location_set_at, property_type, levels, created_by)
       VALUES (:tenantId, :code, :ownerId, :agentId, ${scopeAgentId != null ? 'NOW()' : 'NULL'},
               :address, :latitude, :longitude, ${hasCoords ? 'NOW()' : 'NULL'}, :type, :levels, :createdBy)`,
      {
        tenantId,
        code,
        ownerId: data.ownerId,
        agentId: scopeAgentId,
        address: data.address,
        latitude: data.latitude ?? null,
        longitude: data.longitude ?? null,
        type: data.propertyType,
        levels: data.levels ?? null,
        createdBy: userId,
      },
    );
    const propertyId = result.insertId;

    // Étape 51bis : ouvre la première période de `property_owner_history` (migration 078) — sans cette
    // ligne, un Bien créé après la migration n'aurait AUCUNE période, et toute requête comptable qui
    // résout le propriétaire en vigueur à une date donnée (`getEscrowBalances`, `getRecetteProprietaire`)
    // ne trouverait jamais personne pour lui.
    await conn.query(
      'INSERT INTO property_owner_history (tenant_id, property_id, owner_id, starts_on, set_by) VALUES (:tenantId, :propertyId, :ownerId, CURDATE(), :setBy)',
      { tenantId, propertyId, ownerId: data.ownerId, setBy: userId },
    );

    if (files && files.length > 0) {
      const photoPaths = await writePhotos(tenantId, propertyId, files);
      await conn.query('UPDATE properties SET photo_paths = :paths WHERE id = :id AND tenant_id = :tenantId', {
        paths: JSON.stringify(photoPaths),
        id: propertyId,
        tenantId,
      });
    }

    await conn.commit();
    return { propertyId, code };
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/** Modifie un Bien (+ ajout de photos) ; renvoie la ligne à jour. */
async function updateProperty(tenantId, userId, id, scopeAgentId, data, files) {
  const conn = await pool.getConnection();
  let ownerChanging = false;
  try {
    const property = await loadProperty(conn, tenantId, id, scopeAgentId);

    ownerChanging = data.ownerId !== undefined && Number(data.ownerId) !== Number(property.owner_id);
    if (data.ownerId !== undefined) {
      await assertOwnerExists(conn, tenantId, data.ownerId);
    }

    const fields = [];
    const params = { id, tenantId };
    if (data.ownerId !== undefined) { fields.push('owner_id = :ownerId'); params.ownerId = data.ownerId; }
    if (data.address !== undefined) { fields.push('address = :address'); params.address = data.address; }
    if (data.latitude !== undefined) { fields.push('latitude = :latitude'); params.latitude = data.latitude; }
    if (data.longitude !== undefined) { fields.push('longitude = :longitude'); params.longitude = data.longitude; }
    if (data.latitude !== undefined || data.longitude !== undefined) {
      fields.push(data.latitude != null ? 'location_set_at = NOW()' : 'location_set_at = NULL');
    }
    if (data.propertyType !== undefined) { fields.push('property_type = :type'); params.type = data.propertyType; }
    if (data.levels !== undefined) { fields.push('levels = :levels'); params.levels = data.levels; }

    let existingPhotos = property.photo_paths || [];
    if (files && files.length > 0) {
      const startIndex = existingPhotos.length;
      const newPaths = await writePhotos(
        tenantId,
        id,
        files.slice(0, Math.max(0, MAX_PHOTOS_PER_PROPERTY - existingPhotos.length)),
        startIndex,
      );
      existingPhotos = [...existingPhotos, ...newPaths];
      fields.push('photo_paths = :photos');
      params.photos = JSON.stringify(existingPhotos);
    }

    if (ownerChanging) {
      // Audit comptable (étape 51bis) : réattribuer le propriétaire d'un Bien réécrivait auparavant
      // silencieusement tout son historique financier (voir `property_owner_history`, migration 078) —
      // la comptabilité ne regarde QUE `properties.owner_id`, jamais quand il a changé. Clôture la
      // période en vigueur et en ouvre une nouvelle à la date d'aujourd'hui : tout ce qui a déjà été
      // réellement perçu/dépensé reste attribué à l'ANCIEN propriétaire, seul l'avenir appartient au
      // nouveau. `FOR UPDATE` sérialise deux réattributions concurrentes du même Bien.
      await conn.beginTransaction();
      const [[openPeriod]] = await conn.query(
        'SELECT id FROM property_owner_history WHERE property_id = :id AND ends_on IS NULL FOR UPDATE',
        { id },
      );
      if (openPeriod) {
        await conn.query('UPDATE property_owner_history SET ends_on = CURDATE() WHERE id = :id', { id: openPeriod.id });
      }
      await conn.query(
        `INSERT INTO property_owner_history (tenant_id, property_id, owner_id, starts_on, set_by)
         VALUES (:tenantId, :propertyId, :ownerId, CURDATE(), :setBy)`,
        { tenantId, propertyId: id, ownerId: data.ownerId, setBy: userId },
      );
    }

    if (fields.length > 0) {
      await conn.query(`UPDATE properties SET ${fields.join(', ')} WHERE id = :id AND tenant_id = :tenantId`, params);
    }

    if (ownerChanging) await conn.commit();

    return loadProperty(pool, tenantId, id);
  } catch (err) {
    if (ownerChanging) await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/** Ajoute une unité locative à un Bien. */
async function createUnit(tenantId, userId, propertyId, scopeAgentId, data) {
  const conn = await pool.getConnection();
  try {
    const property = await loadProperty(conn, tenantId, propertyId, scopeAgentId);
    await assertMeterNumbersAvailable(conn, tenantId, data);
    const code = await nextUnitCode(conn, property.code, propertyId);

    await conn.beginTransaction();
    await assertWithinLimit(tenantId, 'units', conn);
    const [result] = await conn.query(
      `INSERT INTO property_units
         (tenant_id, property_id, code, designation, designation_custom, monthly_rent,
          soneb_meter_number, sbee_meter_number, furnished, created_by)
       VALUES (:tenantId, :propertyId, :code, :designation, :designationCustom, :rent,
               :sonebMeterNumber, :sbeeMeterNumber, :furnished, :createdBy)`,
      {
        tenantId,
        propertyId,
        code,
        designation: data.designation,
        designationCustom: data.designationCustom,
        rent: data.monthlyRent,
        sonebMeterNumber: data.sonebMeterNumber,
        sbeeMeterNumber: data.sbeeMeterNumber,
        furnished: data.furnished ? 1 : 0,
        createdBy: userId,
      },
    );

    await conn.commit();
    return { unitId: result.insertId, code };
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/** Modifie une unité (loyer, compteurs, statut manuel) ; renvoie la ligne à jour. */
async function updateUnit(tenantId, propertyId, unitId, scopeAgentId, data) {
  await loadProperty(pool, tenantId, propertyId, scopeAgentId);
  const [unitRows] = await pool.query(
    'SELECT * FROM property_units WHERE id = :unitId AND property_id = :propertyId LIMIT 1',
    { unitId, propertyId },
  );
  if (!unitRows[0]) throw new ApiError(404, 'Unité introuvable');

  await assertMeterNumbersAvailable(pool, tenantId, data, unitId);

  if (data.status === 'loue') {
    const [activeLease] = await pool.query(
      "SELECT id FROM leases WHERE unit_id = :unitId AND status = 'active' LIMIT 1",
      { unitId },
    );
    if (!activeLease[0]) {
      throw new ApiError(400, "Impossible de marquer « Loué » sans bail actif : créez un locataire pour cette unité.");
    }
  }

  const fields = [];
  const params = { unitId, tenantId };
  if (data.designation !== undefined) { fields.push('designation = :designation'); params.designation = data.designation; }
  if (data.designationCustom !== undefined) { fields.push('designation_custom = :designationCustom'); params.designationCustom = data.designationCustom; }
  if (data.monthlyRent !== undefined) { fields.push('monthly_rent = :rent'); params.rent = data.monthlyRent; }
  if (data.sonebMeterNumber !== undefined) { fields.push('soneb_meter_number = :soneb'); params.soneb = data.sonebMeterNumber; }
  if (data.sbeeMeterNumber !== undefined) { fields.push('sbee_meter_number = :sbee'); params.sbee = data.sbeeMeterNumber; }
  if (data.furnished !== undefined) { fields.push('furnished = :furnished'); params.furnished = data.furnished ? 1 : 0; }
  if (data.status !== undefined) { fields.push('status = :status'); params.status = data.status; }

  if (fields.length > 0) {
    await pool.query(`UPDATE property_units SET ${fields.join(', ')} WHERE id = :unitId AND tenant_id = :tenantId`, params);
  }

  const [updated] = await pool.query(
    `SELECT u.*, cu.first_name AS creator_first_name, cu.last_name AS creator_last_name, cu.role AS creator_role
     FROM property_units u LEFT JOIN users cu ON cu.id = u.created_by WHERE u.id = :unitId`,
    { unitId },
  );
  return updated[0];
}

/**
 * Le locataire a quitté : termine le bail actif s'il y en a un, puis remet l'unité « Libre ».
 * Renvoie la ligne d'unité à jour et l'id du bail terminé (ou null).
 */
async function releaseUnit(tenantId, propertyId, unitId, scopeAgentId) {
  const conn = await pool.getConnection();
  try {
    await loadProperty(conn, tenantId, propertyId, scopeAgentId);
    const [unitRows] = await conn.query(
      'SELECT * FROM property_units WHERE id = :unitId AND property_id = :propertyId LIMIT 1',
      { unitId, propertyId },
    );
    if (!unitRows[0]) throw new ApiError(404, 'Unité introuvable');
    if (unitRows[0].status === 'libre') {
      throw new ApiError(400, 'Cette unité est déjà libre.');
    }

    const [activeLeaseRows] = await conn.query(
      "SELECT id FROM leases WHERE unit_id = :unitId AND tenant_id = :tenantId AND status = 'active' LIMIT 1",
      { unitId, tenantId },
    );

    await conn.beginTransaction();
    let releasedLeaseId = null;
    if (activeLeaseRows[0]) {
      releasedLeaseId = activeLeaseRows[0].id;
      await conn.query(
        "UPDATE leases SET status = 'ended', end_date = :endDate WHERE id = :id",
        { endDate: new Date().toISOString().slice(0, 10), id: releasedLeaseId },
      );
    }
    await conn.query("UPDATE property_units SET status = 'libre' WHERE id = :unitId", { unitId });
    await conn.commit();

    const [updated] = await pool.query('SELECT * FROM property_units WHERE id = :unitId', { unitId });
    return { unit: updated[0], releasedLeaseId };
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = {
  loadProperty,
  listProperties,
  listPropertyUnits,
  createProperty,
  updateProperty,
  createUnit,
  updateUnit,
  releaseUnit,
};
