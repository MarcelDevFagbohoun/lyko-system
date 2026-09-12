-- Étape 4 (ajustement) : personnalisation du contrat/attestation de loyer.
-- contract_template : texte du corps de l'attestation avec placeholders
-- {{locataire}} {{telephone}} {{bien}} {{date_entree}} {{loyer}} {{entreprise}}
-- {{rccm}} {{ifu}} {{signataire}} {{date}} — NULL = modèle par défaut intégré.
-- stamp_path / signature_path : images apposées automatiquement sur le PDF généré.

ALTER TABLE tenants
  ADD COLUMN contract_template TEXT NULL AFTER logo_path,
  ADD COLUMN stamp_path VARCHAR(255) NULL AFTER contract_template,
  ADD COLUMN signature_path VARCHAR(255) NULL AFTER stamp_path;
