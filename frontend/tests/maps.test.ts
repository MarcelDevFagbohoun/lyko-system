import { test } from "node:test";
import assert from "node:assert/strict";
import {
  directionsUrl, geolocationErrorMessage, isValidCoords, parsePastedCoords, shareText, smsShareUrl, viewUrl, whatsappShareUrl,
} from "../lib/maps.ts";

const c = { lat: 6.36682, lng: 2.39468 };

test("liens Google Maps : itinéraire et vue", () => {
  assert.equal(directionsUrl(c), "https://www.google.com/maps/dir/?api=1&destination=6.366820,2.394680");
  assert.equal(viewUrl(c), "https://www.google.com/maps/search/?api=1&query=6.366820,2.394680");
  assert.equal(directionsUrl({ lat: -1.5, lng: -2 }), "https://www.google.com/maps/dir/?api=1&destination=-1.500000,-2.000000");
});

test("texte de partage : bien, adresse et itinéraire, sans donnée personnelle", () => {
  const t = shareText({ code: "BIEN-012", address: " Fidjrossè, Cotonou " }, c);
  assert.equal(t, "📍 Bien BIEN-012\nFidjrossè, Cotonou\nItinéraire : https://www.google.com/maps/dir/?api=1&destination=6.366820,2.394680");
  assert.equal(shareText({ code: "B1", address: null }, c).split("\n").length, 2);
  assert.ok(whatsappShareUrl(t).startsWith("https://wa.me/?text=%F0%9F%93%8D"));
  assert.ok(smsShareUrl("a b").endsWith("a%20b"));
});

test("coordonnées collées depuis Google Maps", () => {
  assert.deepEqual(parsePastedCoords("6.366820, 2.394680"), c);
  assert.deepEqual(parsePastedCoords(" 6.36682 2.39468 "), c);
  assert.deepEqual(parsePastedCoords("6.36682;2.39468"), c);
  assert.deepEqual(parsePastedCoords("-1.5,-2"), { lat: -1.5, lng: -2 });
  assert.equal(parsePastedCoords("91, 2"), null); // latitude hors limites
  assert.equal(parsePastedCoords("6.3, 181"), null);
  assert.equal(parsePastedCoords("Cotonou"), null);
  assert.equal(parsePastedCoords("6.3"), null);
});

test("validité des coordonnées et messages d'erreur GPS", () => {
  assert.equal(isValidCoords(6.3, 2.3), true);
  assert.equal(isValidCoords(null, 2.3), false);
  assert.equal(isValidCoords(NaN, 2.3), false);
  assert.equal(isValidCoords(100, 2.3), false);
  assert.match(geolocationErrorMessage(1), /refusée/);
  assert.match(geolocationErrorMessage(3), /trop de temps/);
  assert.match(geolocationErrorMessage(99), /Impossible/);
});
