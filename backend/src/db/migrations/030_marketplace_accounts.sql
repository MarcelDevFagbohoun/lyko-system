-- Quick Immo (site externe séparé, relié à cette plateforme) : comptes du
-- GRAND PUBLIC (chercheurs de logement et propriétaires) — une réalité
-- totalement différente des employés (`users`) ou des locataires/
-- propriétaires déjà connus du cabinet (`renters`/`owners`) : ce sont des
-- inconnus qui s'inscrivent eux-mêmes, jamais créés par un employé.
-- `tenant_id` scope à quel cabinet (v1 : un seul, KIko Store) — gardé dès
-- maintenant pour ne pas tout re-modéliser si Quick Immo dessert plusieurs
-- cabinets un jour.
CREATE TABLE marketplace_accounts (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  role ENUM('chercheur','proprietaire') NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  password_hash VARCHAR(100) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_marketplace_accounts_phone (tenant_id, phone),
  KEY idx_marketplace_accounts_tenant (tenant_id),
  CONSTRAINT fk_marketplace_accounts_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- « Confier un bien » : un propriétaire (compte ci-dessus, role=proprietaire)
-- demande à être mis en relation avec le cabinet pour LOUER ou VENDRE un
-- bien. Volontairement une simple DEMANDE à valider par un humain — Lyko
-- System n'a aujourd'hui aucune notion de « Bien à vendre » (tout son modèle
-- est construit autour de baux/loyers) ; si acceptée, l'employé la saisit
-- normalement comme un vrai Bien, jamais de création automatique.
CREATE TABLE marketplace_requests (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  account_id INT UNSIGNED NOT NULL,
  request_type ENUM('louer','vendre') NOT NULL,
  address VARCHAR(255) NOT NULL,
  description TEXT NULL,
  status ENUM('en_attente','contactee','acceptee','refusee') NOT NULL DEFAULT 'en_attente',
  reviewed_by INT UNSIGNED NULL,
  reviewed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_marketplace_requests_tenant (tenant_id, status),
  CONSTRAINT fk_marketplace_requests_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_marketplace_requests_account FOREIGN KEY (account_id) REFERENCES marketplace_accounts(id) ON DELETE CASCADE,
  -- ON DELETE SET NULL : supprimer un employé ne doit jamais effacer la trace
  -- de qui a traité une demande passée (même convention que partout ailleurs
  -- pour les colonnes d'auteur — étape 16).
  CONSTRAINT fk_marketplace_requests_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Favoris d'un compte « chercheur » sur une Unité publiée en marketplace.
CREATE TABLE marketplace_favorites (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  account_id INT UNSIGNED NOT NULL,
  unit_id INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_marketplace_favorites (account_id, unit_id),
  CONSTRAINT fk_marketplace_favorites_account FOREIGN KEY (account_id) REFERENCES marketplace_accounts(id) ON DELETE CASCADE,
  CONSTRAINT fk_marketplace_favorites_unit FOREIGN KEY (unit_id) REFERENCES property_units(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
