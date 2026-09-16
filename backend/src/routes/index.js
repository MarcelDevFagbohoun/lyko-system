'use strict';

const { Router } = require('express');
const healthRoutes = require('./health');
const authRoutes = require('./auth');
const employeeRoutes = require('./employees');
const renterRoutes = require('./renters');
const leaseRoutes = require('./leases');
const settingsRoutes = require('./settings');
const propertyRoutes = require('./properties');
const ownerRoutes = require('./owners');
const complaintRoutes = require('./complaints');
const accountingRoutes = require('./accounting');
const chargeRoutes = require('./charges');
const utilityReadingRoutes = require('./utilityReadings');
const dashboardRoutes = require('./dashboard');
const portalRoutes = require('./portal');
const ownerPortalRoutes = require('./ownerPortal');
const taskRoutes = require('./tasks');
const historyRoutes = require('./history');
const marketplaceRoutes = require('./marketplace');
const marketplaceAccountRoutes = require('./marketplaceAccounts');
const documentRoutes = require('./documents');
const documentVerificationRoutes = require('./documentVerification');

const router = Router();

router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/employees', employeeRoutes);
router.use('/properties', propertyRoutes);
router.use('/owners', ownerRoutes);
router.use('/renters', renterRoutes);
router.use('/leases', leaseRoutes);
router.use('/complaints', complaintRoutes);
router.use('/accounting', accountingRoutes);
router.use('/charges', chargeRoutes);
// Portail locataire (lien secret, pas de compte employé) : `/portal/:token/*`.
// DOIT être monté avant `utilityReadingRoutes` ci-dessous : ce dernier n'a pas
// de préfixe (monté à la racine de /api) et exige `requireAuth` dès son entrée,
// sans condition de chemin — toute route montée après lui qui ne matche aucun
// préfixe déjà consommé plus haut se retrouverait forcée par l'auth employé
// avant même d'atteindre son propre routeur (bug constaté : 401 systématique).
router.use('/portal', portalRoutes);
// Portail propriétaire (étape 13, idée n°1) : même piège que ci-dessus, doit
// aussi être monté avant `utilityReadingRoutes`.
router.use('/owner-portal', ownerPortalRoutes);
// Tableau de bord « Mes tâches » (comptable/agent, étape 18) : même piège
// que ci-dessus, doit aussi être monté avant `utilityReadingRoutes`.
router.use('/tasks', taskRoutes);
// Historique personnel (comptable/agent, étape 18) : même piège, même raison.
router.use('/history', historyRoutes);
// Marketplace : sa route `/public/:tenantId` est PUBLIQUE (aucune auth) —
// même piège que ci-dessus, doit être montée avant `utilityReadingRoutes`.
router.use('/marketplace', marketplaceRoutes);
// Comptes Quick Immo (grand public, site externe séparé) : entièrement
// public/self-service, même piège, même raison.
router.use('/marketplace-accounts', marketplaceAccountRoutes);
// Compteurs de téléchargement / réinitialisation (espace employé, étape 29) :
// même piège que ci-dessus, doit être monté avant `utilityReadingRoutes`.
router.use('/documents', documentRoutes);
// Vérification publique d'authenticité par code (étape 29) : PUBLIQUE, aucune
// auth — même piège, doit être montée avant `utilityReadingRoutes`.
router.use('/verify', documentVerificationRoutes);
// Relevé de compteurs par immeuble (étape 9bis) : routes /properties/:id/utility-*
// et /utility-batches/* — montées à la racine de /api (permission `charges`).
router.use(utilityReadingRoutes);
router.use('/settings', settingsRoutes);
router.use('/dashboard', dashboardRoutes);

module.exports = router;
