import { test } from "node:test";
import assert from "node:assert/strict";
import { groupByMonth, sumBy } from "../lib/group-by-month.ts";
import {
  normalizeBeninPhone,
  toE164Benin,
  buildWhatsAppHref,
  isValidRegistrationPhone,
  passwordStrength,
  PASSWORD_RE,
  IFU_RE,
  RCCM_RE,
} from "../lib/validation/auth.ts";
import { todayIso } from "../lib/dates.ts";

test("groupByMonth : du plus récent au plus ancien, dates illisibles en dernier", () => {
  const rows = [
    { id: 1, d: "2026-08-03" },
    { id: 2, d: "2026-09-14" },
    { id: 3, d: "2026-09-01" },
    { id: 4, d: null },
    { id: 5, d: "2026-13-01" },
  ];
  const groups = groupByMonth(rows, (r) => r.d);
  assert.deepEqual(
    groups.map((g) => [g.month, g.items.map((i) => i.id)]),
    [
      ["2026-09", [2, 3]],
      ["2026-08", [1]],
      ["", [4, 5]],
    ],
  );
  assert.equal(sumBy(rows, (r) => r.id), 15);
});

test("normalizeBeninPhone : formats locaux et internationaux", () => {
  for (const raw of ["0152933715", "+229 01 52 93 37 15", "00229 0152933715", "01.52.93.37.15"]) {
    assert.equal(normalizeBeninPhone(raw), "0152933715", raw);
  }
  for (const bad of ["", "52933715", "0152933", "abc", "+33 6 12 34 56 78"]) {
    assert.equal(normalizeBeninPhone(bad), null, bad);
  }
});

test("E.164 et lien WhatsApp", () => {
  assert.equal(toE164Benin("0152933715"), "+229152933715");
  assert.equal(toE164Benin("pas un numéro"), "pas un numéro");
  assert.equal(buildWhatsAppHref("0152933715", "Bonjour & merci"), "https://wa.me/229152933715?text=Bonjour%20%26%20merci");
});

test("isValidRegistrationPhone : Bénin local, autre pays UEMOA via libphonenumber", () => {
  assert.equal(isValidRegistrationPhone("BJ", "0152933715"), true);
  assert.equal(isValidRegistrationPhone("BJ", "12345"), false);
  assert.equal(isValidRegistrationPhone("SN", "+221 77 123 45 67"), true);
  assert.equal(isValidRegistrationPhone("SN", "0152933715"), false);
});

test("mot de passe, IFU, RCCM", () => {
  assert.equal(PASSWORD_RE.test("Abcdef12!x"), true);
  assert.equal(PASSWORD_RE.test("abcdef12!x"), false);
  assert.equal(PASSWORD_RE.test("Abc1!"), false);
  assert.equal(passwordStrength("Abcdef12!x").score, 5);
  assert.equal(passwordStrength("").label, "Très faible");
  assert.equal(IFU_RE.test("1234567890123"), true);
  assert.equal(IFU_RE.test("123"), false);
  assert.equal(RCCM_RE.test("RB/COT/21 B 12345"), true);
  assert.equal(RCCM_RE.test("XX/COT/21 B 12345"), false);
});

test("todayIso : AAAA-MM-JJ en heure locale", () => {
  assert.match(todayIso(), /^\d{4}-\d{2}-\d{2}$/);
  const d = new Date();
  assert.equal(todayIso(), `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
});
