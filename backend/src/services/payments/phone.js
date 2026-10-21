'use strict';

/**
 * Numéro Mobile Money du Bénin → forme canonique '+229XXXXXXXX' (8 chiffres, ancien format) ou '+22901XXXXXXXX'
 * (10 chiffres, format en vigueur depuis 2024). Rejette tout le reste (lettres, symboles, autre pays).
 */
function normalizeBeninPhone(raw) {
  if (typeof raw !== 'string') return null;
  const compact = raw.replace(/[\s.\-()]/g, '');
  if (!/^\+?\d+$/.test(compact)) return null;
  let digits = compact.replace(/^\+/, '');
  if (digits.startsWith('00229')) digits = digits.slice(2);
  if (digits.startsWith('229')) digits = digits.slice(3);
  if (/^\d{8}$/.test(digits)) return `+229${digits}`;
  if (/^01\d{8}$/.test(digits)) return `+229${digits}`;
  return null;
}

function maskPhone(phone) {
  if (!phone) return '';
  return `${phone.slice(0, 6)}••••${phone.slice(-2)}`;
}

function maskEmail(email) {
  if (!email) return '';
  const [local, domain] = String(email).split('@');
  if (!domain) return '••••';
  return `${local.slice(0, 1)}••••@${domain}`;
}

module.exports = { normalizeBeninPhone, maskPhone, maskEmail };
