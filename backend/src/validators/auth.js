'use strict';

const { z } = require('zod');
const { isValidPhoneNumber, parsePhoneNumber } = require('libphonenumber-js');
const { REGISTRATION_COUNTRY_CODES } = require('../constants/countries');

/**
 * Validations métier de l'inscription/connexion (section 4.2 du cahier des charges) :
 * numéro béninois, RCCM, IFU, robustesse du mot de passe.
 */

// Numérotation béninoise post-2021 : 10 chiffres locaux commençant par 0
// (ex. 0161234567). On accepte aussi la saisie avec indicatif (+229 / 229 / 00229).
const PHONE_LOCAL_RE = /^0\d{9}$/;

function normalizeBeninPhone(raw) {
  if (typeof raw !== 'string') return null;
  let s = raw.replace(/[\s.\-]/g, '');
  if (s.startsWith('+229')) s = s.slice(4);
  else if (s.startsWith('00229')) s = s.slice(5);
  else if (s.startsWith('229') && s.length === 12) s = s.slice(3);
  return PHONE_LOCAL_RE.test(s) ? s : null;
}

const phoneSchema = z.string().transform((val, ctx) => {
  const normalized = normalizeBeninPhone(val);
  if (!normalized) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Numéro béninois invalide (10 chiffres, ex. 0161234567)',
    });
    return z.NEVER;
  }
  return normalized;
});

/**
 * Connexion (demande utilisateur, 2026-10-18, suite à l'ajout du pays à l'inscription) : plus
 * permissive que `phoneSchema` ci-dessus — un compte DG non-béninois a désormais son numéro
 * stocké au format E.164 (`+228…`, voir `normalizeRegistrationPhone`), jamais au format local
 * à 10 chiffres. Essaie d'abord la normalisation béninoise stricte (comportement inchangé pour
 * 100 % des comptes existants) ; à défaut, retombe sur la saisie telle quelle (espaces/points/
 * tirets retirés) — une recherche en base qui ne trouve rien se comporte comme n'importe quel
 * mauvais numéro (message générique, aucune fuite d'information).
 */
const loginPhoneSchema = z.string().transform((val) => {
  const beninLocal = normalizeBeninPhone(val);
  if (beninLocal) return beninLocal;
  return typeof val === 'string' ? val.replace(/[\s.-]/g, '') : val;
});

/**
 * Numéro de téléphone du DG à l'inscription (demande utilisateur, 2026-10-18) : le pays choisi
 * détermine le format attendu. Bénin : comportement STRICTEMENT inchangé (`normalizeBeninPhone`,
 * local à 10 chiffres) — aucun risque de régression pour l'écrasante majorité des inscriptions
 * réelles à ce jour. Les 7 autres pays UEMOA proposés : validés par `libphonenumber-js` (format
 * réel par pays, ex. 8 chiffres au Togo, 9 au Sénégal — une regex maison par pays serait un
 * pari risqué, cette bibliothèque est la référence du secteur) puis stockés au format E.164
 * (`+228…`), qui ne peut jamais entrer en collision avec un numéro béninois local (lequel
 * commence toujours par `0`, jamais par `+`) — l'unicité globale du téléphone
 * (`routes/auth.js`) reste donc valable sans aucun changement.
 */
function normalizeRegistrationPhone(country, raw) {
  if (country === 'BJ') return normalizeBeninPhone(raw);
  if (typeof raw !== 'string') return null;
  const candidate = raw.trim();
  if (!isValidPhoneNumber(candidate, country)) return null;
  return parsePhoneNumber(candidate, country).number;
}

const countrySchema = z.enum(REGISTRATION_COUNTRY_CODES, { errorMap: () => ({ message: 'Pays invalide' }) });

// Email de l'inscription (demande utilisateur, 2026-10-18) : OBLIGATOIRE, contrairement à celui
// (facultatif) d'un employé (`validators/employee.js`) — c'est lui qui reçoit le code de
// vérification. Normalisé en minuscules (évite qu'une casse différente passe l'unicité globale
// puis échoue à la vérification).
const registrationEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Email invalide')
  .max(190, 'Trop long');

// Registre du Commerce et du Crédit Mobilier (OHADA) : ex. RB/COT/21 B 1234.
const RCCM_RE = /^RB\/[A-Z]{2,4}\/\d{2}\s?[A-Z]\s?\d{3,7}$/;
const rccmSchema = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase())
  .refine((v) => RCCM_RE.test(v), 'Format RCCM invalide (ex. RB/COT/21 B 1234)');

// Identifiant Fiscal Unique (DGI Bénin) : 13 chiffres.
const IFU_RE = /^\d{13}$/;
const ifuSchema = z.string().trim().refine((v) => IFU_RE.test(v), 'IFU invalide (13 chiffres)');

// Min. 10 caractères, au moins une minuscule, une majuscule, un chiffre, un caractère spécial.
const PASSWORD_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{10,72}$/;
const passwordSchema = z
  .string()
  .refine(
    (v) => PASSWORD_RE.test(v),
    'Le mot de passe doit contenir au moins 10 caractères, une majuscule, une minuscule, un chiffre et un caractère spécial',
  );

const nameSchema = z.string().trim().min(2, 'Trop court').max(100, 'Trop long');

const registerSchema = z
  .object({
    firstName: nameSchema,
    lastName: nameSchema,
    companyName: z.string().trim().min(2, 'Trop court').max(180, 'Trop long'),
    rccm: rccmSchema,
    ifu: ifuSchema,
    email: registrationEmailSchema,
    country: countrySchema,
    // Pas encore normalisé ici (dépend de `country`, ci-dessous) — juste une borne de longueur
    // généreuse pour couvrir n'importe quelle saisie (espaces, indicatif international…).
    phone: z.string().trim().min(4, 'Numéro requis').max(20, 'Trop long'),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Les mots de passe ne correspondent pas',
    path: ['confirmPassword'],
  })
  .transform((data, ctx) => {
    const normalizedPhone = normalizeRegistrationPhone(data.country, data.phone);
    if (!normalizedPhone) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['phone'], message: 'Numéro invalide pour le pays choisi' });
      return z.NEVER;
    }
    return { ...data, phone: normalizedPhone };
  });

const loginSchema = z.object({
  phone: loginPhoneSchema,
  password: z.string().min(1, 'Mot de passe requis'),
});

// Vérification d'email à l'inscription (demande utilisateur, 2026-10-18) : code à 8 chiffres.
const verifyEmailSchema = z.object({
  email: registrationEmailSchema,
  code: z.string().trim().regex(/^\d{8}$/, 'Code invalide (8 chiffres)'),
});

const resendVerificationCodeSchema = z.object({
  email: registrationEmailSchema,
});

// Connexion « porte employé » : identifiant généré à la création + poste
// (doit correspondre au rôle réel du compte) + mot de passe.
const employeeLoginSchema = z.object({
  identifier: z
    .string()
    .trim()
    .toUpperCase()
    .min(4, 'Identifiant requis'),
  role: z.enum(['comptable', 'agent'], { errorMap: () => ({ message: 'Poste invalide' }) }),
  password: z.string().min(1, 'Mot de passe requis'),
});

// Changement de mot de passe (auto-service) — sert aussi au changement
// obligatoire de mot de passe temporaire à la première connexion (étape 3).
const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Mot de passe actuel requis'),
    newPassword: passwordSchema,
    confirmNewPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmNewPassword, {
    message: 'Les mots de passe ne correspondent pas',
    path: ['confirmNewPassword'],
  });

module.exports = {
  registerSchema,
  loginSchema,
  employeeLoginSchema,
  changePasswordSchema,
  verifyEmailSchema,
  resendVerificationCodeSchema,
  normalizeBeninPhone,
  normalizeRegistrationPhone,
  RCCM_RE,
  IFU_RE,
  PASSWORD_RE,
  // Briques réutilisées par validators/employee.js
  phoneSchema,
  nameSchema,
  passwordSchema,
};
