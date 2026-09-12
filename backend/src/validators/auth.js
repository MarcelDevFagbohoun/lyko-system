'use strict';

const { z } = require('zod');

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
    phone: phoneSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Les mots de passe ne correspondent pas',
    path: ['confirmPassword'],
  });

const loginSchema = z.object({
  phone: phoneSchema,
  password: z.string().min(1, 'Mot de passe requis'),
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
  normalizeBeninPhone,
  RCCM_RE,
  IFU_RE,
  PASSWORD_RE,
  // Briques réutilisées par validators/employee.js
  phoneSchema,
  nameSchema,
  passwordSchema,
};
