-- Mise en conformité du plan comptable SYSCOHADA (audit du 24/10/2026) : trois comptes de charges étaient mal numérotés.
--   Transports            : 628 -> 618 (classe 61 « Transports » ; 628 est « Frais de télécommunications »)
--   Communication         : 6281 -> 628 (Frais de télécommunications)
--   Marketing / publicité : 638 -> 627 (Publicité, publications, relations publiques)
-- Les écritures déjà passées pointent sur l'identifiant du compte : elles suivent le nouveau numéro, sans rien recalculer.
-- Ordre important : 628 doit être libéré avant d'être réutilisé (clé unique tenant + code). Rejouable sans effet.
UPDATE gl_accounts a
   SET a.code = '618', a.label = 'Autres frais de transport'
 WHERE a.code = '628' AND a.label LIKE 'Transports%'
   AND NOT EXISTS (SELECT 1 FROM (SELECT tenant_id FROM gl_accounts WHERE code = '618') x WHERE x.tenant_id = a.tenant_id);

UPDATE gl_accounts a
   SET a.code = '628', a.label = 'Frais de télécommunications (téléphone, internet)'
 WHERE a.code = '6281'
   AND NOT EXISTS (SELECT 1 FROM (SELECT tenant_id FROM gl_accounts WHERE code = '628') y WHERE y.tenant_id = a.tenant_id);

UPDATE gl_accounts a
   SET a.code = '627', a.label = 'Publicité, publications, relations publiques'
 WHERE a.code = '638' AND a.label LIKE 'Autres charges externes%'
   AND NOT EXISTS (SELECT 1 FROM (SELECT tenant_id FROM gl_accounts WHERE code = '627') z WHERE z.tenant_id = a.tenant_id);
